"""Radio (portables Internetradio für Windows) in Home Assistant."""

from __future__ import annotations

from datetime import timedelta
import logging

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .api import RadioApi, RadioError

DOMAIN = "radio_player"
PLATFORMS = [Platform.MEDIA_PLAYER]
_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    api = RadioApi(
        async_get_clientsession(hass),
        entry.data["host"],
        entry.data["client_id"],
        entry.data["key"],
        entry.data.get("admin_pin", ""),
    )

    async def update() -> dict:
        try:
            return await api.state()
        except RadioError as err:
            # shortcut: kein Reauth-Dialog – bei neuem Schlüssel am Radio die Integration neu einrichten
            raise UpdateFailed(str(err)) from err

    coordinator = DataUpdateCoordinator(
        hass, _LOGGER, config_entry=entry, name=DOMAIN, update_method=update, update_interval=timedelta(seconds=5)
    )
    await coordinator.async_config_entry_first_refresh()
    entry.runtime_data = (api, coordinator)
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
