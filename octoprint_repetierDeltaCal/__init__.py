#coding=utf-8
from __future__ import absolute_import

import octoprint.plugin
import octoprint.server

class RepetierDeltaCalPlugin(octoprint.plugin.AssetPlugin,
                            octoprint.plugin.TemplatePlugin):
    def on_after_startup(self):
        self._logger.info("Octoprint Delta Auto Calibration for Repetier firmware started up!")
		
    def get_assets(self):
        return dict(
            js=["js/repetierDeltaCal.js"]
        )

    def get_template_configs(self):
        return [
            dict(type="settings", template="repetierDeltaCal_settings.jinja2", custom_bindings=True)
        ]

    def get_update_information(self):
        return dict(
            systemcommandeditor=dict(
                displayName="Repetier Delta Calibration Plugin",
                displayVersion=self._plugin_version,

                # version check: github repository
                type="github_release",
                user="hanhha",
                repo="OctoPrint-Delta-Calibration",
                current=self._plugin_version,

                # update method: pip
                pip="https://github.com/hanhha/OctoPrint-Delta-Calibration/archive/{target_version}.zip"
            )
        )

__plugin_name__ = "Repetier Delta Calibration Plugin"

def __plugin_load__():
    global __plugin_implementation__
    __plugin_implementation__ = RepetierDeltaCalPlugin()

    global __plugin_hooks__
    __plugin_hooks__ = {
        "octoprint.plugin.softwareupdate.check_config": __plugin_implementation__.get_update_information
}
