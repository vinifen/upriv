mod disk_auth;

pub use disk_auth::{
    delete_disk_session, has_disk_session, persist_disk_session, read_disk_session,
    session_enc_path, uses_disk_session,
};

use zeroize::{Zeroize, ZeroizeOnDrop};

/// Password bytes held only in RAM for an active vault session.
#[derive(Clone, Zeroize, ZeroizeOnDrop)]
pub struct SessionPassword(Vec<u8>);

impl SessionPassword {
    pub fn new(password: impl Into<Vec<u8>>) -> Self {
        Self(password.into())
    }

    pub fn as_bytes(&self) -> &[u8] {
        &self.0
    }

    pub fn as_str(&self) -> Option<&str> {
        std::str::from_utf8(&self.0).ok()
    }
}

impl From<&str> for SessionPassword {
    fn from(value: &str) -> Self {
        Self::new(value.as_bytes().to_vec())
    }
}
