//! Long jobs a person can stop: a vault export, Back up now, and the zip of
//! the data folder.
//!
//! The UI names each job with an id it sends with the request, then asks
//! `job_status` and `job_cancel` by that id. A stop can arrive while the
//! request still waits for its lane; it is kept, and the job ends as soon as
//! it starts. A stop removes the job's unfinished file, and the log says
//! when that removal fails.

use std::collections::{HashMap, VecDeque};
use std::io::{Read, Seek, SeekFrom, Write};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, LazyLock, Mutex};

use crate::error::{Result, UprivError};

/// Longest job id, in bytes. The UI's ids are far shorter.
const JOB_ID_MAX_BYTES: usize = 64;
/// Stops kept for jobs that have not started. A stop for a job that already
/// ended is never claimed, so the oldest ones are dropped.
const EARLY_STOPS_KEPT: usize = 64;

/// How far a running job got.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct JobStatus {
    pub bytes_done: u64,
    /// Zero until the job has measured its work. A file that grows while it is
    /// read can push the bytes done past it; [`job_status`] caps that.
    pub bytes_total: u64,
}

#[derive(Debug, Default)]
struct JobState {
    bytes_done: AtomicU64,
    bytes_total: AtomicU64,
    stop: AtomicBool,
}

#[derive(Default)]
struct Jobs {
    running: HashMap<String, Arc<JobState>>,
    stopped_early: VecDeque<String>,
    /// Upriv is quitting: every job that starts from now on is stopped.
    quitting: bool,
}

type Registry = &'static Mutex<Jobs>;

static JOBS: LazyLock<Mutex<Jobs>> = LazyLock::new(|| Mutex::new(Jobs::default()));

fn lock(registry: Registry) -> Result<std::sync::MutexGuard<'static, Jobs>> {
    registry
        .lock()
        .map_err(|_| super::session_lock_poisoned("job lock poisoned"))
}

/// Letters, digits, `-`, and `_`, so an id never carries a path or a name.
fn is_valid_job_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= JOB_ID_MAX_BYTES
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// One job in flight. Its id is free again once this is dropped.
pub(crate) struct Job {
    listed: Option<(Registry, String)>,
    state: Arc<JobState>,
}

impl Job {
    /// Run as `id` until dropped. Refused with [`UprivError::JobCancelled`]
    /// when the job was stopped before it started, or Upriv is quitting.
    pub(crate) fn start(id: &str) -> Result<Self> {
        Self::start_in(&JOBS, id)
    }

    fn start_in(registry: Registry, id: &str) -> Result<Self> {
        if !is_valid_job_id(id) {
            return Err(UprivError::JobIdInvalid);
        }
        let mut jobs = lock(registry)?;
        if jobs.quitting {
            return Err(UprivError::JobCancelled);
        }
        if let Some(at) = jobs.stopped_early.iter().position(|early| early == id) {
            jobs.stopped_early.remove(at);
            return Err(UprivError::JobCancelled);
        }
        if jobs.running.contains_key(id) {
            return Err(UprivError::JobIdInvalid);
        }
        let state = Arc::new(JobState::default());
        jobs.running.insert(id.to_string(), Arc::clone(&state));
        Ok(Self {
            listed: Some((registry, id.to_string())),
            state,
        })
    }

    /// Work nobody watches or stops: the backup a close writes, and the
    /// safety zip before a password or unlock-RAM change.
    pub(crate) fn untracked() -> Self {
        Self {
            listed: None,
            state: Arc::default(),
        }
    }

    pub(crate) fn set_total(&self, bytes: u64) {
        self.state.bytes_total.store(bytes, Ordering::Relaxed);
    }

    pub(crate) fn advance(&self, bytes: u64) {
        self.state.bytes_done.fetch_add(bytes, Ordering::Relaxed);
    }

    pub(crate) fn is_stopped(&self) -> bool {
        self.state.stop.load(Ordering::Relaxed)
    }

    /// A checkpoint between steps: fails once a stop was asked for.
    pub(crate) fn ensure_running(&self) -> Result<()> {
        if self.is_stopped() {
            return Err(UprivError::JobCancelled);
        }
        Ok(())
    }

    /// A failure that comes after a stop reads as the stop: the write that
    /// [`JobWriter`] refused surfaces as whatever error its caller wraps it in.
    pub(crate) fn settle<T>(&self, result: Result<T>) -> Result<T> {
        match result {
            Err(_) if self.is_stopped() => Err(UprivError::JobCancelled),
            other => other,
        }
    }

    /// `inner`, refusing every write once a stop was asked for.
    pub(crate) fn writer<W: Write>(&self, inner: W) -> JobWriter<'_, W> {
        JobWriter { inner, job: self }
    }

    /// `inner`, counting each byte read as done.
    pub(crate) fn progress_reader<R: Read>(&self, inner: R) -> ProgressReader<'_, R> {
        ProgressReader { inner, job: self }
    }
}

impl Drop for Job {
    fn drop(&mut self) {
        let Some((registry, id)) = self.listed.take() else {
            return;
        };
        if let Ok(mut jobs) = registry.lock() {
            jobs.running.remove(&id);
        }
    }
}

/// Fails each write once its job is asked to stop, so a long copy ends at its
/// next block instead of finishing the file.
pub(crate) struct JobWriter<'a, W> {
    inner: W,
    job: &'a Job,
}

impl<W> JobWriter<'_, W> {
    pub(crate) fn into_inner(self) -> W {
        self.inner
    }
}

impl<W: Write> Write for JobWriter<'_, W> {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        if self.job.is_stopped() {
            return Err(std::io::Error::other("job stopped"));
        }
        self.inner.write(buf)
    }

    fn flush(&mut self) -> std::io::Result<()> {
        self.inner.flush()
    }
}

impl<W: Seek> Seek for JobWriter<'_, W> {
    fn seek(&mut self, pos: SeekFrom) -> std::io::Result<u64> {
        self.inner.seek(pos)
    }
}

/// Moves its job's progress by the bytes read through it.
pub(crate) struct ProgressReader<'a, R> {
    inner: R,
    job: &'a Job,
}

impl<R: Read> Read for ProgressReader<'_, R> {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        if self.job.is_stopped() {
            return Err(std::io::Error::other("job stopped"));
        }
        let read = self.inner.read(buf)?;
        self.job.advance(read as u64);
        Ok(read)
    }
}

/// How far the job `id` got, or `None` when it is not running.
pub fn job_status(id: &str) -> Option<JobStatus> {
    status_in(&JOBS, id)
}

fn status_in(registry: Registry, id: &str) -> Option<JobStatus> {
    let jobs = lock(registry).ok()?;
    let state = jobs.running.get(id)?;
    let bytes_total = state.bytes_total.load(Ordering::Relaxed);
    let bytes_done = state.bytes_done.load(Ordering::Relaxed);
    Some(JobStatus {
        bytes_done: if bytes_total > 0 {
            bytes_done.min(bytes_total)
        } else {
            bytes_done
        },
        bytes_total,
    })
}

/// Ask the job `id` to stop. True when it was running. Otherwise the stop is
/// kept, so the job ends as soon as it starts.
pub fn cancel_job(id: &str) -> bool {
    cancel_in(&JOBS, id)
}

fn cancel_in(registry: Registry, id: &str) -> bool {
    if !is_valid_job_id(id) {
        return false;
    }
    let Ok(mut jobs) = lock(registry) else {
        return false;
    };
    if let Some(state) = jobs.running.get(id) {
        state.stop.store(true, Ordering::Relaxed);
        return true;
    }
    if !jobs.stopped_early.iter().any(|early| early == id) {
        if jobs.stopped_early.len() == EARLY_STOPS_KEPT {
            jobs.stopped_early.pop_front();
        }
        jobs.stopped_early.push_back(id.to_string());
    }
    false
}

/// Upriv is quitting: stop every running job, and every one that starts
/// later in this process, such as a request still waiting for its lane.
/// Returns how many were running.
pub fn stop_all_jobs() -> usize {
    stop_all_in(&JOBS)
}

fn stop_all_in(registry: Registry) -> usize {
    let Ok(mut jobs) = lock(registry) else {
        return 0;
    };
    jobs.quitting = true;
    for state in jobs.running.values() {
        state.stop.store(true, Ordering::Relaxed);
    }
    jobs.running.len()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::test_job_id;

    #[test]
    fn status_follows_the_job_until_it_is_dropped() {
        let id = test_job_id();
        let job = Job::start(&id).unwrap();
        assert_eq!(
            job_status(&id),
            Some(JobStatus {
                bytes_done: 0,
                bytes_total: 0
            })
        );
        job.set_total(10);
        job.advance(4);
        assert_eq!(
            job_status(&id),
            Some(JobStatus {
                bytes_done: 4,
                bytes_total: 10
            })
        );
        job.advance(20);
        assert_eq!(job_status(&id).unwrap().bytes_done, 10);
        drop(job);
        assert_eq!(job_status(&id), None);
    }

    #[test]
    fn a_stop_reaches_the_running_job() {
        let id = test_job_id();
        let job = Job::start(&id).unwrap();
        job.ensure_running().unwrap();
        assert!(cancel_job(&id));
        assert!(matches!(
            job.ensure_running(),
            Err(UprivError::JobCancelled)
        ));
    }

    #[test]
    fn a_stop_before_the_start_ends_the_job_once() {
        let id = test_job_id();
        assert!(!cancel_job(&id));
        assert!(matches!(Job::start(&id), Err(UprivError::JobCancelled)));
        // The stop was claimed; the id can run again.
        let job = Job::start(&id).unwrap();
        job.ensure_running().unwrap();
    }

    #[test]
    fn an_id_runs_once_at_a_time() {
        let id = test_job_id();
        let _job = Job::start(&id).unwrap();
        assert!(matches!(Job::start(&id), Err(UprivError::JobIdInvalid)));
    }

    #[test]
    fn ids_carry_no_path_or_name() {
        for id in [
            "",
            "../x",
            "a b",
            "a/b",
            "é",
            &"x".repeat(JOB_ID_MAX_BYTES + 1),
        ] {
            assert!(matches!(Job::start(id), Err(UprivError::JobIdInvalid)));
            assert!(!cancel_job(id));
        }
    }

    #[test]
    fn early_stops_are_bounded() {
        let first = test_job_id();
        cancel_job(&first);
        for _ in 0..EARLY_STOPS_KEPT {
            cancel_job(&test_job_id());
        }
        // The oldest stop was dropped, so its job runs.
        let job = Job::start(&first).unwrap();
        job.ensure_running().unwrap();
    }

    #[test]
    fn the_writer_refuses_once_stopped_and_settle_names_the_stop() {
        let id = test_job_id();
        let job = Job::start(&id).unwrap();
        let mut out = job.writer(Vec::new());
        out.write_all(b"before").unwrap();
        cancel_job(&id);
        assert!(out.write_all(b"after").is_err());
        assert_eq!(out.into_inner(), b"before");
        let failed: Result<()> = Err(UprivError::VaultBackupFailed);
        assert!(matches!(job.settle(failed), Err(UprivError::JobCancelled)));
        assert!(job.settle(Ok(())).is_ok());
    }

    #[test]
    fn the_progress_reader_counts_what_it_reads() {
        let id = test_job_id();
        let job = Job::start(&id).unwrap();
        job.set_total(11);
        let mut read = Vec::new();
        job.progress_reader(&b"hello world"[..])
            .read_to_end(&mut read)
            .unwrap();
        assert_eq!(read, b"hello world");
        assert_eq!(
            job_status(&id),
            Some(JobStatus {
                bytes_done: 11,
                bytes_total: 11
            })
        );
    }

    #[test]
    fn quitting_stops_running_jobs_and_refuses_new_ones() {
        let registry: Registry = Box::leak(Box::default());
        let running = Job::start_in(registry, "running").unwrap();
        assert_eq!(stop_all_in(registry), 1);
        assert!(matches!(
            running.ensure_running(),
            Err(UprivError::JobCancelled)
        ));
        assert!(matches!(
            Job::start_in(registry, "queued"),
            Err(UprivError::JobCancelled)
        ));
        assert!(status_in(registry, "running").is_some());
        drop(running);
        assert!(status_in(registry, "running").is_none());
        assert!(!cancel_in(registry, "running"));
    }

    #[test]
    fn untracked_work_is_never_listed_or_stopped() {
        let job = Job::untracked();
        let mut out = job.writer(Vec::new());
        out.write_all(b"close backup").unwrap();
        job.ensure_running().unwrap();
        let failed: Result<()> = Err(UprivError::VaultBackupFailed);
        assert!(matches!(
            job.settle(failed),
            Err(UprivError::VaultBackupFailed)
        ));
    }
}
