import os
import json
import base64
import tempfile
from pathlib import Path

MAX_ARTWORK_SIZE = 5 * 1024 * 1024
MAX_METADATA_SIZE = 32 * 1024 * 1024


def _image_mime(data: bytes) -> str | None:
    """Identify supported embedded image formats."""
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith((b"GIF87a", b"GIF89a")):
        return "image/gif"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def _id3_text_terminator(data: bytes, start: int, encoding: int) -> int:
    """Find the end of an ID3 text description."""
    if encoding in (1, 2):
        end = start
        while end + 1 < len(data):
            if data[end:end + 2] == b"\x00\x00":
                return end + 2
            end += 2
        return len(data)

    end = data.find(b"\x00", start)
    return len(data) if end < 0 else end + 1


def _extract_id3_picture(payload: bytes, version: int):
    """Extract an ID3 APIC or PIC image."""
    if not payload or payload[0] not in (0, 1, 2, 3):
        return None

    encoding = payload[0]

    if version == 2:
        if len(payload) < 5:
            return None
        image_format = payload[1:4].decode("ascii", errors="ignore").upper()
        description_offset = 5
    else:
        mime_end = payload.find(b"\x00", 1)
        if mime_end < 0 or mime_end + 1 >= len(payload):
            return None
        description_offset = mime_end + 2

    description_end = _id3_text_terminator(
        payload, description_offset, encoding
    )
    image_data = payload[description_end:]

    if not image_data or len(image_data) > MAX_ARTWORK_SIZE:
        return None

    mime = _image_mime(image_data)
    if not mime:
        return None

    return image_data, mime


def _extract_mp3_artwork(path: Path):
    """Extract embedded artwork from an MP3 ID3 tag."""
    try:
        with path.open("rb") as audio_file:
            header = audio_file.read(10)

            if len(header) != 10 or header[:3] != b"ID3":
                return None

            version = header[3]
            if version not in (2, 3, 4):
                return None

            size_bytes = header[6:10]
            if any(value & 0x80 for value in size_bytes):
                return None

            tag_size = (
                (size_bytes[0] << 21)
                | (size_bytes[1] << 14)
                | (size_bytes[2] << 7)
                | size_bytes[3]
            )

            if not 0 < tag_size <= MAX_METADATA_SIZE:
                return None

            tag = audio_file.read(tag_size)

        offset = 0

        if header[5] & 0x40:
            if len(tag) < 4:
                return None

            if version == 3:
                offset = 4 + int.from_bytes(tag[:4], "big")
            elif version == 4:
                ext = tag[:4]
                if any(value & 0x80 for value in ext):
                    return None
                offset = (
                    (ext[0] << 21)
                    | (ext[1] << 14)
                    | (ext[2] << 7)
                    | ext[3]
                )

        frame_header_size = 6 if version == 2 else 10

        while offset + frame_header_size <= len(tag):
            frame = tag[offset:offset + frame_header_size]

            if not frame.strip(b"\x00"):
                break

            if version == 2:
                frame_id = frame[:3].decode("ascii", errors="ignore")
                frame_size = int.from_bytes(frame[3:6], "big")
            else:
                frame_id = frame[:4].decode("ascii", errors="ignore")
                raw_size = frame[4:8]

                if version == 4:
                    if any(value & 0x80 for value in raw_size):
                        break
                    frame_size = (
                        (raw_size[0] << 21)
                        | (raw_size[1] << 14)
                        | (raw_size[2] << 7)
                        | raw_size[3]
                    )
                else:
                    frame_size = int.from_bytes(raw_size, "big")

            offset += frame_header_size

            if frame_size <= 0 or offset + frame_size > len(tag):
                break

            if frame_id in ("APIC", "PIC"):
                if frame_size <= MAX_ARTWORK_SIZE + 1024:
                    result = _extract_id3_picture(
                        tag[offset:offset + frame_size], version
                    )
                    if result:
                        return result

            offset += frame_size

    except (OSError, ValueError):
        return None

    return None


def _extract_id3_artwork_data(data: bytes):
    """Extract embedded artwork from an ID3 tag supplied as bytes."""
    if len(data) < 10 or data[:3] != b"ID3":
        return None

    version = data[3]
    if version not in (2, 3, 4):
        return None

    size_bytes = data[6:10]
    if any(value & 0x80 for value in size_bytes):
        return None

    tag_size = (
        (size_bytes[0] << 21)
        | (size_bytes[1] << 14)
        | (size_bytes[2] << 7)
        | size_bytes[3]
    )

    if not 0 < tag_size <= MAX_METADATA_SIZE:
        return None

    tag = data[10:10 + tag_size]
    if len(tag) != tag_size:
        return None

    offset = 0

    if data[5] & 0x40:
        if len(tag) < 4:
            return None

        if version == 3:
            offset = 4 + int.from_bytes(tag[:4], "big")
        elif version == 4:
            ext = tag[:4]
            if any(value & 0x80 for value in ext):
                return None
            offset = (
                (ext[0] << 21)
                | (ext[1] << 14)
                | (ext[2] << 7)
                | ext[3]
            )

        if offset > len(tag):
            return None

    frame_header_size = 6 if version == 2 else 10

    while offset + frame_header_size <= len(tag):
        frame = tag[offset:offset + frame_header_size]

        if not frame.strip(b"\x00"):
            break

        if version == 2:
            frame_id = frame[:3].decode("ascii", errors="ignore")
            frame_size = int.from_bytes(frame[3:6], "big")
        else:
            frame_id = frame[:4].decode("ascii", errors="ignore")
            raw_size = frame[4:8]

            if version == 4:
                if any(value & 0x80 for value in raw_size):
                    break
                frame_size = (
                    (raw_size[0] << 21)
                    | (raw_size[1] << 14)
                    | (raw_size[2] << 7)
                    | raw_size[3]
                )
            else:
                frame_size = int.from_bytes(raw_size, "big")

        offset += frame_header_size

        if frame_size <= 0 or offset + frame_size > len(tag):
            break

        if frame_id in ("APIC", "PIC"):
            if frame_size <= MAX_ARTWORK_SIZE + 1024:
                result = _extract_id3_picture(
                    tag[offset:offset + frame_size], version
                )
                if result:
                    return result

        offset += frame_size

    return None


def _extract_wav_artwork(path: Path):
    """Extract embedded artwork from a RIFF/WAVE ID3 chunk."""
    try:
        with path.open("rb") as audio_file:
            header = audio_file.read(12)

            if len(header) != 12 or header[:4] != b"RIFF" or header[8:12] != b"WAVE":
                return None

            riff_size = int.from_bytes(header[4:8], "little")
            if riff_size < 4:
                return None

            file_end = min(path.stat().st_size, riff_size + 8)
            offset = 12
            metadata_read = 0

            while offset + 8 <= file_end:
                audio_file.seek(offset)
                chunk_header = audio_file.read(8)

                if len(chunk_header) != 8:
                    return None

                chunk_id = chunk_header[:4]
                chunk_size = int.from_bytes(chunk_header[4:8], "little")
                chunk_start = offset + 8
                chunk_end = chunk_start + chunk_size

                if chunk_end > file_end:
                    return None

                if chunk_id in (b"ID3 ", b"id3 "):
                    if chunk_size > MAX_METADATA_SIZE:
                        return None

                    metadata_read += chunk_size
                    if metadata_read > MAX_METADATA_SIZE:
                        return None

                    tag = audio_file.read(chunk_size)
                    if len(tag) != chunk_size:
                        return None

                    result = _extract_id3_artwork_data(tag)
                    if result:
                        return result

                offset = chunk_end + (chunk_size & 1)

    except (OSError, ValueError, OverflowError):
        return None

    return None


def _extract_flac_artwork(path: Path):
    """Extract an embedded FLAC PICTURE metadata block."""
    try:
        with path.open("rb") as audio_file:
            if audio_file.read(4) != b"fLaC":
                return None

            last_block = False

            while not last_block:
                header = audio_file.read(4)
                if len(header) != 4:
                    return None

                last_block = bool(header[0] & 0x80)
                block_type = header[0] & 0x7F
                block_size = int.from_bytes(header[1:4], "big")

                if block_type != 6:
                    audio_file.seek(block_size, 1)
                    continue

                if not 32 <= block_size <= MAX_ARTWORK_SIZE + 1024 * 1024:
                    audio_file.seek(block_size, 1)
                    continue

                picture = audio_file.read(block_size)
                if len(picture) != block_size:
                    return None

                offset = 4

                mime_length = int.from_bytes(
                    picture[offset:offset + 4], "big"
                )
                offset += 4

                if mime_length > 255 or offset + mime_length + 4 > len(picture):
                    continue

                offset += mime_length

                description_length = int.from_bytes(
                    picture[offset:offset + 4], "big"
                )
                offset += 4

                if description_length > 65536:
                    continue

                offset += description_length

                if offset + 20 > len(picture):
                    continue

                # Skip width, height, colour depth and palette count.
                offset += 16

                image_length = int.from_bytes(
                    picture[offset:offset + 4], "big"
                )
                offset += 4

                if not 0 < image_length <= MAX_ARTWORK_SIZE:
                    continue

                if offset + image_length > len(picture):
                    continue

                image_data = picture[offset:offset + image_length]
                mime = _image_mime(image_data)

                if mime:
                    return image_data, mime

    except (OSError, ValueError):
        return None

    return None


def _extract_flac_picture_data(picture: bytes):
    """Decode a FLAC-style embedded picture metadata block."""
    try:
        offset = 4
        mime_length = int.from_bytes(picture[offset:offset + 4], "big")
        offset += 4

        if mime_length > 255 or offset + mime_length + 4 > len(picture):
            return None

        offset += mime_length
        description_length = int.from_bytes(
            picture[offset:offset + 4], "big"
        )
        offset += 4

        if description_length > 65536:
            return None

        offset += description_length

        if offset + 20 > len(picture):
            return None

        offset += 16
        image_length = int.from_bytes(
            picture[offset:offset + 4], "big"
        )
        offset += 4

        if not 0 < image_length <= MAX_ARTWORK_SIZE:
            return None

        if offset + image_length > len(picture):
            return None

        image_data = picture[offset:offset + image_length]
        mime = _image_mime(image_data)

        if mime:
            return image_data, mime

    except (IndexError, ValueError):
        pass

    return None


def _extract_ogg_comment_artwork(packet: bytes):
    """Extract artwork from Vorbis comments or OpusTags."""
    try:
        if packet.startswith(b"\x03vorbis"):
            offset = 7
        elif packet.startswith(b"OpusTags"):
            offset = 8
        else:
            return None

        if offset + 4 > len(packet):
            return None

        vendor_length = int.from_bytes(packet[offset:offset + 4], "little")
        offset += 4 + vendor_length

        if offset + 4 > len(packet):
            return None

        comment_count = int.from_bytes(packet[offset:offset + 4], "little")
        offset += 4

        if comment_count > 10000:
            return None

        cover_art = None
        cover_mime = None

        for _ in range(comment_count):
            if offset + 4 > len(packet):
                return None

            length = int.from_bytes(packet[offset:offset + 4], "little")
            offset += 4

            if length > MAX_METADATA_SIZE or offset + length > len(packet):
                return None

            comment = packet[offset:offset + length]
            offset += length

            key, separator, value = comment.partition(b"=")
            if not separator:
                continue

            key = key.decode("ascii", errors="ignore").upper()

            if key == "METADATA_BLOCK_PICTURE":
                import base64
                encoded = value.decode("ascii", errors="ignore")
                if len(encoded) > MAX_ARTWORK_SIZE * 2:
                    continue
                try:
                    picture = base64.b64decode(encoded, validate=True)
                except (ValueError, UnicodeError):
                    continue

                result = _extract_flac_picture_data(picture)
                if result:
                    return result

            elif key == "COVERART" and cover_art is None:
                import base64
                encoded = value.decode("ascii", errors="ignore")
                if len(encoded) > MAX_ARTWORK_SIZE * 2:
                    continue
                try:
                    cover_art = base64.b64decode(encoded, validate=True)
                except (ValueError, UnicodeError):
                    cover_art = None

            elif key == "COVERARTMIME":
                cover_mime = value.decode("ascii", errors="ignore")

        if cover_art and len(cover_art) <= MAX_ARTWORK_SIZE:
            mime = _image_mime(cover_art)
            if mime:
                return cover_art, mime

    except (IndexError, ValueError, OverflowError):
        return None

    return None


def _extract_ogg_artwork(path: Path):
    """Extract artwork from OGG Vorbis or Opus files."""
    packet = bytearray()
    packet_count = 0
    serial_number = None

    try:
        with path.open("rb") as audio_file:
            while True:
                header = audio_file.read(27)

                if not header:
                    break

                if len(header) != 27 or header[:4] != b"OggS" or header[4] != 0:
                    return None

                page_serial = int.from_bytes(header[14:18], "little")
                segment_count = header[26]
                lacing = audio_file.read(segment_count)

                if len(lacing) != segment_count:
                    return None

                if serial_number is None:
                    serial_number = page_serial
                elif page_serial != serial_number:
                    continue

                for segment_size in lacing:
                    if len(packet) + segment_size > MAX_METADATA_SIZE:
                        return None

                    chunk = audio_file.read(segment_size)
                    if len(chunk) != segment_size:
                        return None

                    packet.extend(chunk)

                    if segment_size < 255:
                        packet_count += 1

                        if packet_count == 1:
                            if not (
                                packet.startswith(b"\x01vorbis")
                                or packet.startswith(b"OpusHead")
                            ):
                                return None

                        elif packet_count == 2:
                            return _extract_ogg_comment_artwork(
                                bytes(packet)
                            )

                        packet.clear()

    except OSError:
        return None

    return None


def _mp4_atoms(data: bytes, start: int = 0, end: int = None):
    """Iterate through MP4 atoms, including extended-size atoms."""
    if end is None:
        end = len(data)

    offset = start

    while offset + 8 <= end:
        size = int.from_bytes(data[offset:offset + 4], "big")
        atom_type = data[offset + 4:offset + 8]
        header_size = 8

        if size == 1:
            if offset + 16 > end:
                return
            size = int.from_bytes(data[offset + 8:offset + 16], "big")
            header_size = 16
        elif size == 0:
            size = end - offset

        if size < header_size or offset + size > end:
            return

        yield atom_type, offset + header_size, offset + size
        offset += size


def _find_mp4_artwork(data: bytes):
    """Find JPEG or PNG artwork in an MP4 covr metadata atom."""
    try:
        for atom_type, atom_start, atom_end in _mp4_atoms(data):
            if atom_type != b"moov":
                continue

            for child_type, child_start, child_end in _mp4_atoms(
                data, atom_start, atom_end
            ):
                if child_type != b"udta":
                    continue

                for meta_type, meta_start, meta_end in _mp4_atoms(
                    data, child_start, child_end
                ):
                    if meta_type != b"meta":
                        continue

                    # The meta atom begins with four version/flags bytes.
                    for ilst_type, ilst_start, ilst_end in _mp4_atoms(
                        data, meta_start + 4, meta_end
                    ):
                        if ilst_type != b"ilst":
                            continue

                        for item_type, item_start, item_end in _mp4_atoms(
                            data, ilst_start, ilst_end
                        ):
                            if item_type != b"covr":
                                continue

                            for value_type, value_start, value_end in _mp4_atoms(
                                data, item_start, item_end
                            ):
                                if value_type != b"data":
                                    continue

                                # Data atom: four-byte type/flags and four-byte locale.
                                if value_end - value_start < 8:
                                    continue

                                image_data = data[value_start + 8:value_end]

                                if not image_data or len(image_data) > MAX_ARTWORK_SIZE:
                                    continue

                                mime = _image_mime(image_data)
                                if mime in ("image/jpeg", "image/png"):
                                    return image_data, mime

    except (ValueError, OverflowError):
        return None

    return None


def _extract_m4a_artwork(path: Path):
    """Extract artwork by reading only the MP4 metadata atom."""
    try:
        with path.open("rb") as audio_file:
            file_size = os.fstat(audio_file.fileno()).st_size
            if file_size <= 0:
                return None

            offset = 0
            while offset + 8 <= file_size:
                audio_file.seek(offset)
                header = audio_file.read(8)
                if len(header) != 8:
                    return None

                atom_size = int.from_bytes(header[:4], "big")
                atom_type = header[4:8]
                header_size = 8

                if atom_size == 1:
                    extended_size = audio_file.read(8)
                    if len(extended_size) != 8:
                        return None
                    header += extended_size
                    atom_size = int.from_bytes(extended_size, "big")
                    header_size = 16
                elif atom_size == 0:
                    atom_size = file_size - offset

                if atom_size < header_size or offset + atom_size > file_size:
                    return None

                if atom_type == b"moov":
                    metadata_size = atom_size - header_size
                    if metadata_size > MAX_METADATA_SIZE:
                        return None

                    metadata = audio_file.read(metadata_size)
                    if len(metadata) != metadata_size:
                        return None

                    return _find_mp4_artwork(header + metadata)

                offset += atom_size

    except (OSError, ValueError, OverflowError):
        return None

    return None


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

            extensions = {".mp3", ".wav", ".flac", ".ogg", ".opus", ".m4a", ".aac"}
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

    async def get_music_artwork(self, path: str) -> str | None:
        """Extract embedded artwork without external dependencies."""
        try:
            if not isinstance(path, str) or not path.strip():
                return None

            root = Path("/home/deck").resolve()
            selected = Path(path).resolve()

            if (
                not selected.is_relative_to(root)
                or not selected.is_file()
                or not os.access(selected, os.R_OK)
            ):
                return None

            extractors = {
                ".mp3": _extract_mp3_artwork,
                ".flac": _extract_flac_artwork,
                ".m4a": _extract_m4a_artwork,
                ".ogg": _extract_ogg_artwork,
                ".opus": _extract_ogg_artwork,
                ".wav": _extract_wav_artwork,
                ".aac": _extract_mp3_artwork,
            }

            extractor = extractors.get(selected.suffix.lower())
            if extractor is None:
                return None

            result = extractor(selected)
            if not result:
                return None

            image_data, mime = result

            if (
                not image_data
                or len(image_data) > MAX_ARTWORK_SIZE
                or _image_mime(image_data) != mime
            ):
                return None

            encoded = base64.b64encode(image_data).decode("ascii")
            return f"data:{mime};base64,{encoded}"

        except (OSError, ValueError):
            return None

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

        extensions = {".mp3", ".wav", ".flac", ".ogg", ".opus", ".m4a", ".aac"}

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
