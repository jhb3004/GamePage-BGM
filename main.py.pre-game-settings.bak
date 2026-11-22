
import os
import json
import tempfile
from pathlib import Path

import decky


DEFAULT_SETTINGS = {
    "enabled": True,
    "games": {}
}


class Plugin:
    def __init__(self):
        self.settings_file = (
            Path(decky.DECKY_PLUGIN_SETTINGS_DIR) / "settings.json"
        )
        self.settings = DEFAULT_SETTINGS.copy()

    def _load_settings(self):
        self.settings_file.parent.mkdir(parents=True, exist_ok=True)

        if not self.settings_file.exists():
            self._save_settings()
            return

        try:
            with self.settings_file.open("r", encoding="utf-8") as file:
                loaded = json.load(file)

            if isinstance(loaded, dict):
                self.settings["enabled"] = bool(
                    loaded.get("enabled", True)
                )

                games = loaded.get("games", {})
                if isinstance(games, dict):
                    self.settings["games"] = {
                        str(app_id): str(path)
                        for app_id, path in games.items()
                        if str(app_id).isdigit()
                        and isinstance(path, str)
                    }

        except (OSError, json.JSONDecodeError) as error:
            decky.logger.error(
                f"Could not load settings: {error}"
            )

    def _save_settings(self):
        self.settings_file.parent.mkdir(
            parents=True,
            exist_ok=True
        )

        temp_path = None

        try:
            with tempfile.NamedTemporaryFile(
                mode="w",
                encoding="utf-8",
                dir=self.settings_file.parent,
                delete=False
            ) as file:
                json.dump(self.settings, file, indent=4)
                file.flush()
                os.fsync(file.fileno())
                temp_path = file.name

            os.replace(temp_path, self.settings_file)

        except OSError as error:
            decky.logger.error(
                f"Could not save settings: {error}"
            )

            if temp_path and os.path.exists(temp_path):
                os.unlink(temp_path)

            raise

    async def get_settings(self):
        return self.settings

    async def set_enabled(self, enabled: bool):
        self.settings["enabled"] = bool(enabled)
        self._save_settings()
        return self.settings["enabled"]

    async def set_game_music(self, app_id: str, path: str):
        app_id = str(app_id)

        if not app_id.isdigit():
            raise ValueError("Invalid Steam App ID")

        if not isinstance(path, str) or not path.strip():
            raise ValueError("Invalid music file path")

        self.settings["games"][app_id] = path
        self._save_settings()

        return True

    async def remove_game_music(self, app_id: str):
        app_id = str(app_id)

        self.settings["games"].pop(app_id, None)
        self._save_settings()

        return True

    async def _main(self):
        self._load_settings()
        decky.logger.info(
            "GamePage BGM backend initialized"
        )

    async def _unload(self):
        decky.logger.info(
            "GamePage BGM backend unloaded"
        )

    async def _uninstall(self):
        decky.logger.info(
            "GamePage BGM uninstalled"
        )
