"""Einrichtung und Mediaplayer gegen ein nachgebautes Radio.

Lokal ausführen (nicht in der CI):
  pip install pytest-homeassistant-custom-component
  pytest test/home_assistant -o pythonpath=.
"""

import json

import pytest

from homeassistant import config_entries
from homeassistant.core import HomeAssistant

DOMAIN = "radio_player"
BASE = "http://192.168.1.50"
STATE = {
    "source": "radio",
    "sourceName": "SWR3",
    "playing": True,
    "title": "Song",
    "artist": "Band",
    "cover": "https://example.org/c.jpg",
    "volume": 0.5,
    "volumeEnabled": True,
    "stations": [{"id": "swr3", "name": "SWR3"}, {"id": "1live", "name": "1LIVE"}],
    "youtube": [{"id": "yt1", "title": "Mix"}],
}


@pytest.fixture(autouse=True)
def auto_enable_custom_integrations(enable_custom_integrations):
    yield


async def test_public_setup_and_control(hass: HomeAssistant, aioclient_mock) -> None:
    aioclient_mock.get(f"{BASE}/api/room", json={"app": "radio", "name": "Radio Büro", "version": "1.13.0"})
    aioclient_mock.post(f"{BASE}/api/join", json={"key": "k1"})
    aioclient_mock.get(f"{BASE}/api/state", json=STATE)
    aioclient_mock.post(f"{BASE}/api/command", json={"ok": True})

    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": config_entries.SOURCE_USER})
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {"host": "192.168.1.50", "admin_pin": ""})
    assert result["type"] == "create_entry"
    assert result["title"] == "Radio Büro"
    assert result["data"]["key"] == "k1"
    await hass.async_block_till_done()

    state = hass.states.get("media_player.radio_buro")
    assert state.state == "playing"
    assert state.attributes["media_title"] == "Song"
    assert state.attributes["source"] == "SWR3"
    assert state.attributes["source_list"] == ["SWR3", "1LIVE", "YouTube: Mix"]

    await hass.services.async_call("media_player", "select_source", {"entity_id": state.entity_id, "source": "1LIVE"}, blocking=True)
    await hass.services.async_call("media_player", "media_pause", {"entity_id": state.entity_id}, blocking=True)
    commands = [json.loads(call[2]) if isinstance(call[2], str) else call[2] for call in aioclient_mock.mock_calls if str(call[1]).endswith("/api/command")]
    assert commands == [{"action": "station", "value": "1live"}, {"action": "toggle", "value": None}]
    # Schlüssel und Gerätekennung gehen mit
    headers = aioclient_mock.mock_calls[-1][3]
    assert headers["x-key"] == "k1" and headers["x-client"].startswith("ha-")


async def test_secure_join(hass: HomeAssistant, aioclient_mock) -> None:
    aioclient_mock.get(f"{BASE}:8080/api/room", json={"app": "radio", "name": "Radio Büro"})
    aioclient_mock.post(f"{BASE}:8080/api/join", status=403, json={"error": "PIN oder Code falsch – ein Code gilt 2 Minuten."})

    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": config_entries.SOURCE_USER})
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {"host": "192.168.1.50:8080", "admin_pin": ""})
    assert result["step_id"] == "join"
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {"pin": "0000"})
    assert result["errors"] == {"base": "invalid_pin"}
