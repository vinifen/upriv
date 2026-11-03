//! Long work a person can stop: opening, creating, importing, the password and
//! unlock-RAM change, exports, backups, file imports, the copy of a data
//! folder, and the removal of a leftover folder.
//!
//! The UI names each job with an id it sends with the request, then asks
//! `job_status` and `job_cancel` by that id. A stop can arrive while the
//! request still waits for its lane; it is kept, and the job ends as soon as
//! it starts. A job in its last step ([`Job::final_step`]) refuses a stop, so
//! that step always finishes. Every job logs when it starts and how it ended,
//! with no path and no name.

use std::collections::{HashMap, VecDeque};
use std::io::{Read, Seek, SeekFrom, Write};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::Instant;

use crate::error::{Result, UprivError};
use crate::failure::classify_write_failure;
use crate::logging::{log_event, LogLevel};

/// Longest job id, in bytes. The UI's ids are far shorter.
const JOB_ID_MAX_BYTES: usize = 64;
/// Stops kept for jobs that have not started. A stop for a job that already
/// ended is never claimed, so the oldest ones are dropped.
const EARLY_STOPS_KEPT: usize = 64;

/// What a job does, as the log names it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum JobKind {
    /// Unlock a vault. A stop discards the unlock.
    VaultOpen,
    /// Write every file of a plain-text vault into its folder on open.
    PlainFill,
    /// A new empty vault.
    VaultCreate,
    /// A new vault from a zip, a `.7z`, files, or a backup.
    VaultImport,
    /// The password test and settings read of a `.7z` before an import.
    ImportProbe,
    /// One file streamed into an open vault.
    FileImport,
    /// The password or unlock-RAM change of a closed vault.
    Rewrap,
    VaultExport,
    BackupSave,
    BackupExport,
    DataFolderExport,
    /// A data folder copied into the folder a phone granted.
    DataFolderCopy,
    /// The wipe of a leftover plain-text folder.
    PlainRemove,
}

impl JobKind {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::VaultOpen => "vault_open",
            Self::PlainFill => "plain_fill",
            Self::VaultCreate => "vault_create",
            Self::VaultImport => "vault_import",
            Self::ImportProbe => "import_probe",
            Self::FileImport => "file_import",
            Self::Rewrap => "rewrap",
            Self::VaultExport => "vault_export",
            Self::BackupSave => "backup_save",
            Self::BackupExport => "backup_export",
            Self::DataFolderExport => "data_folder_export",
            Self::DataFolderCopy => "data_folder_copy",
            Self::PlainRemove => "plain_remove",
        }
    }
}

/// How far a running job got.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct JobStatus {
    pub bytes_done: u64,
    /// Zero until the job has measured its work. A file that grows while it is
    /// read can push the bytes done past it; [`job_status`] caps that.
    pub bytes_total: u64,
    /// False once the job is in its last step: a stop is refused from then on.
    pub stoppable: bool,
}

/// What a stop did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum JobStop {
    /// The job was running and ends at its next step.
    Stopping,
    /// No job runs under that id yet. The stop is kept, and the job ends as
    /// soon as it starts.
    Kept,
}

#[derive(Debug)]
struct JobState {
    bytes_done: AtomicU64,
    bytes_total: AtomicU64,
    stop: Arc<AtomicBool>,
    /// Cleared by [`Job::final_step`], under the registry lock, so a stop and
    /// the last step never cross.
    stoppable: AtomicBool,
}

impl JobState {
    fn new(stop: Arc<AtomicBool>) -> Self {
        Self {
            bytes_done: AtomicU64::new(0),
            bytes_total: AtomicU64::new(0),
            stop,
            stoppable: AtomicBool::new(true),
        }
    }
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
    /// Run `work` as the job `id`. Refused with [`UprivError::JobCancelled`]
    /// when the job was stopped before it started, or Upriv is quitting. Any
    /// failure after a stop reads as the stop. `vault_id` goes to the log when
    /// it is a vault folder id.
    pub(crate) fn run<T>(
        id: &str,
        kind: JobKind,
        vault_id: Option<&str>,
        work: impl FnOnce(&Job) -> Result<T>,
    ) -> Result<T> {
        Self::run_in(&JOBS, id, kind, vault_id, work)
    }

    fn run_in<T>(
        registry: Registry,
        id: &str,
        kind: JobKind,
        vault_id: Option<&str>,
        work: impl FnOnce(&Job) -> Result<T>,
    ) -> Result<T> {
        let job = Self::start_in(registry, id)?;
        let vault_id = vault_id.filter(|id| crate::paths::slug_id_is_valid(id));
        log_started(kind, vault_id);
        let started = Instant::now();
        let result = job.settle(work(&job));
        log_ended(kind, vault_id, &result, started);
        result
    }

    /// A job a test drives by hand, listed under `id` like a real one.
    #[cfg(test)]
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
        let state = Arc::new(JobState::new(Arc::default()));
        jobs.running.insert(id.to_string(), Arc::clone(&state));
        Ok(Self {
            listed: Some((registry, id.to_string())),
            state,
        })
    }

    /// Work nobody watches or stops: the wipe a vault delete runs.
    pub(crate) fn untracked() -> Self {
        Self {
            listed: None,
            state: Arc::new(JobState::new(Arc::default())),
        }
    }

    /// Work nobody watches that stops once `stop` is set: the backup a close
    /// writes, which Close now ends.
    pub(crate) fn stopped_by(stop: Arc<AtomicBool>) -> Self {
        Self {
            listed: None,
            state: Arc::new(JobState::new(stop)),
        }
    }

    /// The id this job is listed under; empty for work nobody can name.
    pub(crate) fn id(&self) -> &str {
        self.listed.as_ref().map_or("", |(_, id)| id.as_str())
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

    /// The flag a stop sets, for work that checks one flag of its own: the
    /// pass that fills a plain-text folder on open.
    pub(crate) fn stop_flag(&self) -> Arc<AtomicBool> {
        Arc::clone(&self.state.stop)
    }

    /// A checkpoint between steps: fails once a stop was asked for.
    pub(crate) fn ensure_running(&self) -> Result<()> {
        if self.is_stopped() {
            return Err(UprivError::JobCancelled);
        }
        Ok(())
    }

    /// Enter the last step, which must finish once it begins: from here a
    /// stop is refused ([`UprivError::JobNotStoppable`]). Fails with
    /// [`UprivError::JobCancelled`] when a stop already arrived, so the step
    /// never begins half stopped.
    pub(crate) fn final_step(&self) -> Result<()> {
        let Some((registry, _)) = &self.listed else {
            return self.ensure_running();
        };
        let _jobs = lock(registry)?;
        self.ensure_running()?;
        self.state.stoppable.store(false, Ordering::Relaxed);
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

fn job_log_fields(kind: JobKind, vault_id: Option<&str>) -> Vec<(&'static str, &str)> {
    let mut fields = vec![("job", kind.as_str())];
    if let Some(id) = vault_id {
        fields.push(("id", id));
    }
    fields
}

fn log_started(kind: JobKind, vault_id: Option<&str>) {
    log_event(
        LogLevel::Info,
        "job_started",
        &job_log_fields(kind, vault_id),
    );
}

/// `outcome` is `done`, `stopped`, or `failed`; a failure adds why
/// ([`classify_write_failure`]).
fn log_ended<T>(kind: JobKind, vault_id: Option<&str>, result: &Result<T>, started: Instant) {
    let elapsed = started.elapsed().as_secs().to_string();
    let mut fields = job_log_fields(kind, vault_id);
    fields.push(("elapsed_s", elapsed.as_str()));
    let error = match result {
        Ok(_) => {
            fields.push(("outcome", "done"));
            log_event(LogLevel::Info, "job_ended", &fields);
            return;
        }
        Err(UprivError::JobCancelled) => {
            fields.push(("outcome", "stopped"));
            log_event(LogLevel::Info, "job_ended", &fields);
            return;
        }
        Err(error) => error,
    };
    let class = classify_write_failure(error);
    let os = class.os.map(|code| code.to_string());
    fields.push(("outcome", "failed"));
    fields.push(("reason", class.reason));
    fields.push(("kind", class.kind));
    if let Some(code) = os.as_deref() {
        fields.push(("os", code));
    }
    log_event(LogLevel::Warn, "job_ended", &fields);
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

/// Moves its job's progress by the bytes read through it, and fails each read
/// once the job is asked to stop.
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

impl<R: Seek> Seek for ProgressReader<'_, R> {
    fn seek(&mut self, pos: SeekFrom) -> std::io::Result<u64> {
        self.inner.seek(pos)
    }
}

/// How far the job `id` got, or `None` when it is not running: not started
/// yet, or already ended.
pub fn job_status(id: &str) -> Option<JobStatus> {
    status_in(&JOBS, id)
}

fn status_in(registry: Registry, id: &str) -> Option<JobStatus> {
    let jobs = lock(registry).ok()?;
    Some(status_of(jobs.running.get(id)?))
}

fn status_of(state: &JobState) -> JobStatus {
    let bytes_total = state.bytes_total.load(Ordering::Relaxed);
    let bytes_done = state.bytes_done.load(Ordering::Relaxed);
    JobStatus {
        bytes_done: if bytes_total > 0 {
            bytes_done.min(bytes_total)
        } else {
            bytes_done
        },
        bytes_total,
        stoppable: state.stoppable.load(Ordering::Relaxed),
    }
}

/// Ask the job `id` to stop. A job in its last step refuses with
/// [`UprivError::JobNotStoppable`]; a malformed id with
/// [`UprivError::JobIdInvalid`].
pub fn cancel_job(id: &str) -> Result<JobStop> {
    cancel_in(&JOBS, id)
}

fn cancel_in(registry: Registry, id: &str) -> Result<JobStop> {
    if !is_valid_job_id(id) {
        return Err(UprivError::JobIdInvalid);
    }
    let mut jobs = lock(registry)?;
    if let Some(state) = jobs.running.get(id) {
        if !state.stoppable.load(Ordering::Relaxed) {
            return Err(UprivError::JobNotStoppable);
        }
        state.stop.store(true, Ordering::Relaxed);
        return Ok(JobStop::Stopping);
    }
    if !jobs.stopped_early.iter().any(|early| early == id) {
        if jobs.stopped_early.len() == EARLY_STOPS_KEPT {
            jobs.stopped_early.pop_front();
        }
        jobs.stopped_early.push_back(id.to_string());
    }
    Ok(JobStop::Kept)
}

/// Upriv is quitting: stop every running job that can still stop, and every
/// one that starts later in this process, such as a request still waiting for
/// its lane. A job in its last step finishes. Returns how many were stopped.
pub fn stop_all_jobs() -> usize {
    stop_all_in(&JOBS)
}

fn stop_all_in(registry: Registry) -> usize {
    let Ok(mut jobs) = lock(registry) else {
        return 0;
    };
    jobs.quitting = true;
    let mut stopped = 0;
    for state in jobs.running.values() {
        if state.stoppable.load(Ordering::Relaxed) {
            state.stop.store(true, Ordering::Relaxed);
            stopped += 1;
        }
    }
    stopped
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::test_job_id;

    fn registry() -> Registry {
        Box::leak(Box::default())
    }

    #[test]
    fn status_follows_the_job_until_it_is_dropped() {
        let id = test_job_id();
        let job = Job::start(&id).unwrap();
        assert_eq!(
            job_status(&id),
            Some(JobStatus {
                bytes_done: 0,
                bytes_total: 0,
                stoppable: true,
            })
        );
        job.set_total(10);
        job.advance(4);
        assert_eq!(
            job_status(&id),
            Some(JobStatus {
                bytes_done: 4,
                bytes_total: 10,
                stoppable: true,
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
        assert_eq!(cancel_job(&id).unwrap(), JobStop::Stopping);
        assert!(matches!(
            job.ensure_running(),
            Err(UprivError::JobCancelled)
        ));
    }

    #[test]
    fn a_stop_before_the_start_ends_the_job_once() {
        let id = test_job_id();
        assert_eq!(cancel_job(&id).unwrap(), JobStop::Kept);
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
            assert!(matches!(cancel_job(id), Err(UprivError::JobIdInvalid)));
        }
    }

    #[test]
    fn early_stops_are_bounded() {
        let first = test_job_id();
        cancel_job(&first).unwrap();
        for _ in 0..EARLY_STOPS_KEPT {
            cancel_job(&test_job_id()).unwrap();
        }
        // The oldest stop was dropped, so its job runs.
        let job = Job::start(&first).unwrap();
        job.ensure_running().unwrap();
    }

    #[test]
    fn the_last_step_refuses_a_stop_and_reports_it() {
        let id = test_job_id();
        let job = Job::start(&id).unwrap();
        job.final_step().unwrap();
        assert!(!job_status(&id).unwrap().stoppable);
        assert!(matches!(cancel_job(&id), Err(UprivError::JobNotStoppable)));
        job.ensure_running().unwrap();
    }

    #[test]
    fn a_stop_that_came_first_keeps_the_last_step_from_starting() {
        let id = test_job_id();
        let job = Job::start(&id).unwrap();
        cancel_job(&id).unwrap();
        assert!(matches!(job.final_step(), Err(UprivError::JobCancelled)));
        assert!(job_status(&id).unwrap().stoppable);
    }

    #[test]
    fn run_returns_the_work_and_frees_the_id() {
        let registry = registry();
        let out = Job::run_in(registry, "done", JobKind::BackupSave, None, |job| {
            job.ensure_running()?;
            Ok(7)
        });
        assert_eq!(out.unwrap(), 7);
        assert!(status_in(registry, "done").is_none());
    }

    #[test]
    fn run_reads_a_failure_after_a_stop_as_the_stop() {
        let registry = registry();
        let out: Result<()> = Job::run_in(registry, "stopped", JobKind::VaultExport, None, |_| {
            cancel_in(registry, "stopped").unwrap();
            Err(UprivError::VaultBackupFailed)
        });
        assert!(matches!(out, Err(UprivError::JobCancelled)));
    }

    #[test]
    fn run_keeps_a_failure_without_a_stop() {
        let registry = registry();
        let out: Result<()> = Job::run_in(registry, "failed", JobKind::VaultImport, None, |_| {
            Err(UprivError::VaultBackupFailed)
        });
        assert!(matches!(out, Err(UprivError::VaultBackupFailed)));
    }

    #[test]
    fn run_honors_a_stop_that_arrived_while_it_waited() {
        let registry = registry();
        assert_eq!(cancel_in(registry, "queued").unwrap(), JobStop::Kept);
        let mut ran = false;
        let out = Job::run_in(registry, "queued", JobKind::VaultOpen, None, |_| {
            ran = true;
            Ok(())
        });
        assert!(matches!(out, Err(UprivError::JobCancelled)));
        assert!(!ran);
    }

    #[test]
    fn the_writer_refuses_once_stopped_and_settle_names_the_stop() {
        let id = test_job_id();
        let job = Job::start(&id).unwrap();
        let mut out = job.writer(Vec::new());
        out.write_all(b"before").unwrap();
        cancel_job(&id).unwrap();
        assert!(out.write_all(b"after").is_err());
        assert_eq!(out.into_inner(), b"before");
        let failed: Result<()> = Err(UprivError::VaultBackupFailed);
        assert!(matches!(job.settle(failed), Err(UprivError::JobCancelled)));
        assert!(job.settle(Ok(())).is_ok());
    }

    #[test]
    fn the_progress_reader_counts_what_it_reads_and_stops_with_its_job() {
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
                bytes_total: 11,
                stoppable: true,
            })
        );
        cancel_job(&id).unwrap();
        let mut more = Vec::new();
        assert!(job
            .progress_reader(&b"more"[..])
            .read_to_end(&mut more)
            .is_err());
    }

    #[test]
    fn quitting_stops_jobs_that_can_stop_and_refuses_new_ones() {
        let registry = registry();
        let running = Job::start_in(registry, "running").unwrap();
        let sealing = Job::start_in(registry, "sealing").unwrap();
        sealing.final_step().unwrap();
        assert_eq!(stop_all_in(registry), 1);
        assert!(matches!(
            running.ensure_running(),
            Err(UprivError::JobCancelled)
        ));
        sealing.ensure_running().unwrap();
        assert!(matches!(
            Job::start_in(registry, "queued"),
            Err(UprivError::JobCancelled)
        ));
        assert!(status_in(registry, "running").is_some());
        drop(running);
        assert!(status_in(registry, "running").is_none());
        assert_eq!(cancel_in(registry, "running").unwrap(), JobStop::Kept);
    }

    #[test]
    fn untracked_work_is_never_listed_or_stopped() {
        let job = Job::untracked();
        let mut out = job.writer(Vec::new());
        out.write_all(b"close backup").unwrap();
        job.ensure_running().unwrap();
        job.final_step().unwrap();
        let failed: Result<()> = Err(UprivError::VaultBackupFailed);
        assert!(matches!(
            job.settle(failed),
            Err(UprivError::VaultBackupFailed)
        ));
    }
}
