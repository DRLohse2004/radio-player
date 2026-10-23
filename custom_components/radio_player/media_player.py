"""Das Radio als Mediaplayer: Wiedergabe, Lautstärke, Sender und gespeicherte YouTube-Einträge als Quellen."""

from __future__ import annotations

from datetime import datetime, timezone

from homeassistant.components.media_player import MediaPlayerEntity, MediaPlayerEntityFeature, MediaPlayerState
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .api import RadioError

YT = "YouTube: "
F = MediaPlayerEntityFeature


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback) -> None:
    api, coordinator = entry.runtime_data
    async_add_entities([RadioPlayer(api, coordinator, entry)])


class RadioPlayer(CoordinatorEntity, MediaPlayerEntity):
    _attr_has_entity_name = True
    _attr_name = None
    _attr_media_image_remotely_accessible = False

    def __init__(self, api, coordinator, entry: ConfigEntry) -> None:
        super().__init__(coordinator)
        self.api = api
        self._attr_unique_id = entry.unique_id
        self._attr_device_info = {"identifiers": {("radio_player", entry.unique_id)}, "name": entry.title, "manufacturer": "Radio"}

    @property
    def s(self) -> dict:
        return self.coordinator.data or {}

    @property
    def state(self) -> MediaPlayerState:
        if self.s.get("playing"):
            return MediaPlayerState.PLAYING
        return MediaPlayerState.PAUSED if self.s.get("source") else MediaPlayerState.IDLE

    @property
    def supported_features(self) -> MediaPlayerEntityFeature:
        features = F.PLAY | F.PAUSE | F.NEXT_TRACK | F.PREVIOUS_TRACK | F.SELECT_SOURCE
        if self.s.get("volumeEnabled", True):
            features |= F.VOLUME_SET | F.VOLUME_STEP
        return features

    @property
    def media_title(self) -> str | None:
        return self.s.get("title") or self.s.get("sourceName") or None

    @property
    def media_artist(self) -> str | None:
        return self.s.get("artist")

    @property
    def media_album_name(self) -> str | None:
        return self.s.get("album")

    @property
    def media_image_url(self) -> str | None:
        return self.s.get("cover")

    @property
    def volume_level(self) -> float | None:
        return self.s.get("volume")

    @property
    def source(self) -> str | None:
        if self.s.get("source") == "radio":
            return self.s.get("sourceName") or None
        return {"youtube": "YouTube", "spotify": "Spotify", "airplay": "AirPlay", "bluetooth": "Bluetooth"}.get(self.s.get("source"))

    @property
    def source_list(self) -> list[str]:
        stations = [st["name"] for st in self.s.get("stations", [])]
        return stations + [YT + i["title"] for i in self.s.get("youtube", []) if i.get("title")]

    @property
    def media_duration(self) -> int | None:
        return (self.s.get("progress") or {}).get("duration")

    @property
    def media_position(self) -> int | None:
        return (self.s.get("progress") or {}).get("position")

    @property
    def media_position_updated_at(self) -> datetime | None:
        at = (self.s.get("progress") or {}).get("at")
        return datetime.fromtimestamp(at / 1000, timezone.utc) if at else None

    async def _send(self, action: str, value=None) -> None:
        try:
            await self.api.command(action, value)
        except RadioError as err:
            raise HomeAssistantError(str(err)) from err
        await self.coordinator.async_request_refresh()

    async def async_media_play(self) -> None:
        if not self.s.get("playing"):
            await self._send("toggle")

    async def async_media_pause(self) -> None:
        if self.s.get("playing"):
            await self._send("toggle")

    async def async_media_next_track(self) -> None:
        await self._send("next")

    async def async_media_previous_track(self) -> None:
        await self._send("prev")

    async def async_set_volume_level(self, volume: float) -> None:
        await self._send("volume", round(volume, 2))

    async def async_select_source(self, source: str) -> None:
        for st in self.s.get("stations", []):
            if st["name"] == source:
                return await self._send("station", st["id"])
        for item in self.s.get("youtube", []):
            if YT + item.get("title", "") == source:
                return await self._send("youtubeItem", item["id"])
        raise HomeAssistantError(f"Quelle „{source}“ gibt es am Radio nicht.")
