
import os
import json
import tempfile
from pathlib import Path

import decky


DEFAULT_SETTINGS = {
    "enabled": True,
    "games": {}
}


def normalize_game_settings(value):
    """Validate and normalize settings for one game."""

    if isinstance(value, str):
        value = {"music": value}

    if not isinstance(value, dict):
        return None

    music = value.get("music", "")
    if not isinstance(music, str):
        music = ""

    try:
        volume = int(value.get("volume", 100))
    except (TypeError, ValueError):
        volume = 100

    try:
        start_offset = int(value.get("startOffset", 0))
    except (TypeError, ValueError):
        start_offset = 0

    playback_mode = value.get("playbackMode", "loop")
    if playback_mode not in ("loop", "once"):
        playback_mode = "loop"

    return {
        "music": music,
        "volume": max(0, min(200, volume)),
        "startOffset": max(0, min(300, start_offset)),
        "playbackMode": playback_mode
    }


class Plugin:
    def __init__(self):
        self.settings_file = (
            Path(decky.DECKY_PLUGIN_SETTINGS_DIR) / "settings.json"
        )
        self.settings = {
            "enabled": True,
            "games": {}
        }

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
                    normalized = {}

                    for app_id, value in games.items():
                        app_id = str(app_id)

                        if not app_id.isdigit():
                            continue

                        game_settings = normalize_game_settings(value)

                        if game_settings is not None:
                            normalized[app_id] = game_settings

                    self.settings["games"] = normalized

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

    async def save_game_settings(self, app_id: str, settings: dict):
        app_id = str(app_id)

        if not app_id.isdigit():
            raise ValueError("Invalid Steam App ID")

        normalized = normalize_game_settings(settings)

        if normalized is None:
            raise ValueError("Invalid game settings")

        self.settings["games"][app_id] = normalized
        self._save_settings()

        return normalized

    async def list_music_directory(self, directory: str = "/home/deck"):
        """List folders and supported audio files for the music browser."""

        try:
            root = Path("/home/deck").resolve()
            requested = Path(directory).resolve()

            if not requested.is_relative_to(root):
                return {"path": str(requested), "parent": None, "entries": [], "error": "Directory is outside the music browser root"}

            if not requested.is_dir():
                return {"path": str(requested), "parent": None, "entries": [], "error": "Directory does not exist"}

            extensions = {".mp3", ".wav", ".flac", ".ogg", ".m4a", ".aac"}
            entries = []

            for item in requested.iterdir():
                try:
                    resolved = item.resolve()

                    if not resolved.is_relative_to(root):
                        continue

                    if item.is_dir():
                        entries.append({
                            "name": item.name,
                            "path": str(resolved),
                            "is_dir": True
                        })
                    elif (
                        item.is_file()
                        and item.suffix.lower() in extensions
                        and os.access(resolved, os.R_OK)
                    ):
                        entries.append({
                            "name": item.name,
                            "path": str(resolved),
                            "is_dir": False
                        })

                except OSError:
                    continue

            entries.sort(key=lambda entry: (not entry["is_dir"], entry["name"].lower()))

            return {
                "path": str(requested),
                "parent": str(requested.parent) if requested != root else None,
                "entries": entries,
                "error": None
            }

        except Exception as error:
            return {
                "path": str(directory),
                "parent": None,
                "entries": [],
                "error": str(error)
            }


    async def set_game_music(self, app_id: str, path: str):
        app_id = str(app_id)

        if not app_id.isdigit():
            raise ValueError("Invalid Steam App ID")

        if not isinstance(path, str) or not path.strip():
            raise ValueError("Invalid music file path")

        root = Path("/home/deck").resolve()
        selected = Path(path).resolve()

        if not selected.is_relative_to(root):
            raise ValueError("Music file is outside the allowed directory")

        extensions = {".mp3", ".wav", ".flac", ".ogg", ".m4a", ".aac"}

        if (
            not selected.is_file()
            or selected.suffix.lower() not in extensions
            or not os.access(selected, os.R_OK)
        ):
            raise ValueError("File is missing, unreadable, or unsupported")

        current = self.settings["games"].get(app_id, {})
        if isinstance(current, str):
            current = {"music": current}

        current = normalize_game_settings(current)
        current["music"] = str(selected)

        self.settings["games"][app_id] = current
        self._save_settings()

        return current

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
