"""Einrichtung: Adresse des Radios, bei gesichertem Zugang Join-PIN oder Einmalcode, optional Admin-PIN."""

from __future__ import annotations

from typing import Any
import uuid

import voluptuous as vol

from homeassistant.config_entries import ConfigFlow, ConfigFlowResult
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from . import DOMAIN
from .api import RadioApi, RadioAuthError, RadioError


class RadioConfigFlow(ConfigFlow, domain=DOMAIN):
    VERSION = 1

    def __init__(self) -> None:
        self.api: RadioApi | None = None
        self.name = "Radio"

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        errors: dict[str, str] = {}
        if user_input is not None:
            host = user_input["host"].strip().removeprefix("http://").rstrip("/")
            self.api = RadioApi(async_get_clientsession(self.hass), host, f"ha-{uuid.uuid4().hex[:12]}", admin_pin=user_input.get("admin_pin", "").strip())
            try:
                info = await self.api.room()
                self.name = info.get("name") or "Radio"
                await self.api.join()
                return await self._finish()
            except RadioAuthError as err:
                # „Aus“ meldet „lässt gerade niemanden herein“, „Sicher“ verlangt PIN oder Code
                if "niemanden" in str(err):
                    errors["base"] = "closed"
                else:
                    return await self.async_step_join()
            except RadioError:
                errors["base"] = "cannot_connect"
        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema({vol.Required("host"): str, vol.Optional("admin_pin", default=""): str}),
            errors=errors,
        )

    async def async_step_join(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        """Gesicherter Zugang: Join-PIN eingeben oder den Code, den das Radio jetzt groß anzeigt."""
        errors: dict[str, str] = {}
        assert self.api
        if user_input is None:
            try:
                await self.api.join(request_code=True)
            except RadioError:
                pass  # dann eben nur mit Join-PIN
        else:
            try:
                await self.api.join(user_input["pin"].strip())
                return await self._finish()
            except RadioAuthError:
                errors["base"] = "invalid_pin"
            except RadioError:
                errors["base"] = "cannot_connect"
        return self.async_show_form(
            step_id="join",
            data_schema=vol.Schema({vol.Required("pin"): str}),
            description_placeholders={"name": self.name},
            errors=errors,
        )

    async def _finish(self) -> ConfigFlowResult:
        assert self.api
        if self.api.admin_pin:
            try:
                await self.api.login()
            except RadioError:
                return self.async_show_form(
                    step_id="user",
                    data_schema=vol.Schema({vol.Required("host", default=self.api.host): str, vol.Optional("admin_pin", default=""): str}),
                    errors={"base": "invalid_admin_pin"},
                )
        await self.async_set_unique_id(self.api.host)
        self._abort_if_unique_id_configured()
        return self.async_create_entry(
            title=self.name,
            data={"host": self.api.host, "client_id": self.api.client_id, "key": self.api.key, "admin_pin": self.api.admin_pin},
        )
