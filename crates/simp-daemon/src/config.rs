pub use simp_core::library::vdf::{
    load_session_state, save_session_state, session_state_vdf_path,
};
use anyhow::Result;
use simp_protocol::SimpSettings;
use std::fs;
use std::path::PathBuf;

pub fn settings_vdf_path() -> PathBuf {
    simp_core::simp_config_dir().join("settings.vdf")
}

pub fn library_db_path() -> PathBuf {
    simp_core::simp_data_dir().join("library.db")
}

pub fn load_or_create_settings() -> SimpSettings {
    let path = settings_vdf_path();
    if let Ok(text) = fs::read_to_string(&path) {
        if let Ok(mut parsed) = keyvalues_serde::from_str::<SimpSettings>(&text) {
            if parsed
                .provisioning
                .widevine_cdm_url_aarch64_linux
                .trim()
                .is_empty()
                || parsed
                    .provisioning
                    .widevine_cdm_url_aarch64_linux
                    .contains("4.10.2710.0-linux-arm64.zip")
            {
                parsed.provisioning.widevine_cdm_url_aarch64_linux =
                    simp_protocol::default_widevine_url_aarch64_linux();
                let _ = save_settings(&parsed);
            }
            return parsed;
        }
    }
    let default_settings = SimpSettings::default();
    let _ = save_settings(&default_settings);
    default_settings
}

pub fn save_settings(settings: &SimpSettings) -> Result<()> {
    let path = settings_vdf_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let vdf_str = keyvalues_serde::to_string_with_key(settings, "SimpSettings")?;
    let tmp_path = path.with_extension("vdf.tmp");
    fs::write(&tmp_path, vdf_str)?;
    fs::rename(&tmp_path, &path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use simp_protocol::SimpSettings;

    #[test]
    fn test_settings_vdf_roundtrip() {
        let default_cfg = SimpSettings::default();
        let vdf_str = keyvalues_serde::to_string_with_key(&default_cfg, "SimpSettings")
            .expect("serialize settings.vdf");
        assert!(vdf_str.contains("\"SimpSettings\""));
        assert!(vdf_str.contains("\"oled_console\""));

        let parsed: SimpSettings =
            keyvalues_serde::from_str(&vdf_str).expect("deserialize settings.vdf");
        assert_eq!(parsed.ui.modality, "oled_console");
        assert_eq!(parsed.ui.battery_dim_timeout_sec, 30);
    }
}


