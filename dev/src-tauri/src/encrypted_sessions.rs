use std::collections::HashMap;
use std::sync::Mutex;

use upriv_core::EncryptedDirSession;

pub struct EncryptedDirSessions(pub Mutex<HashMap<String, EncryptedDirSession>>);

impl EncryptedDirSessions {
    pub fn new() -> Self {
        Self(Mutex::new(HashMap::new()))
    }
}

impl Default for EncryptedDirSessions {
    fn default() -> Self {
        Self::new()
    }
}
