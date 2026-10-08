//! Passwords read from RPC params.

use std::fmt;

use serde::{Deserialize, Deserializer};
use zeroize::Zeroizing;

/// A password from a request: wiped on drop and never printed.
///
/// Deserialize from the parsed `serde_json::Value` (`from_value`), which moves
/// the string out instead of copying it, so this holds the only copy left.
pub(crate) struct SecretString(Zeroizing<String>);

impl SecretString {
    pub(crate) fn as_bytes(&self) -> &[u8] {
        self.0.as_bytes()
    }

    pub(crate) fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

impl<'de> Deserialize<'de> for SecretString {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        String::deserialize(deserializer).map(|value| Self(Zeroizing::new(value)))
    }
}

impl fmt::Debug for SecretString {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("SecretString(<redacted>)")
    }
}

/// Bytes of an optional password, or empty when absent.
pub(crate) fn secret_bytes(secret: Option<&SecretString>) -> &[u8] {
    secret.map_or(&[], SecretString::as_bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[derive(Debug, Deserialize)]
    struct Params {
        password: SecretString,
        #[serde(default)]
        archive_password: Option<SecretString>,
    }

    #[test]
    fn debug_never_prints_the_password() {
        let parsed: Params =
            serde_json::from_value(json!({ "password": "hunter2", "archive_password": "7z-pass" }))
                .unwrap();
        let printed = format!("{parsed:?}");
        assert!(!printed.contains("hunter2"));
        assert!(!printed.contains("7z-pass"));
        assert!(printed.contains("<redacted>"));
    }

    #[test]
    fn from_value_moves_the_parsed_string_instead_of_copying_it() {
        let mut map = serde_json::Map::new();
        let password = String::from("hunter2");
        let ptr = password.as_ptr();
        map.insert("password".into(), serde_json::Value::String(password));
        let parsed: Params = serde_json::from_value(serde_json::Value::Object(map)).unwrap();
        assert_eq!(parsed.password.as_bytes().as_ptr(), ptr);
    }

    #[test]
    fn optional_password_defaults_to_empty_bytes() {
        let parsed: Params = serde_json::from_value(json!({ "password": "" })).unwrap();
        assert!(parsed.password.is_empty());
        assert_eq!(secret_bytes(parsed.archive_password.as_ref()), b"");
    }

    #[test]
    fn rejects_a_non_string_password() {
        assert!(serde_json::from_value::<Params>(json!({ "password": 42 })).is_err());
    }
}
