This is a plugin for the 3D printer host software, OctoPrint (http://www.octoprint.org).

This plugin is forked from the Delta Auto Calibration plugin which is dedicated for delta printers manufactured by SeeMeCNC (http://www.seemecnc.com). I grabbed code from multiple other plugins and made some modification to support:
- Original Repetier firmware which must support G30 g-code command.
- Showing EEPROM parameters which are used for calibration.
- Selectable calibration factors, number of probe points and probe radius.
- Tolerance checking without calibration process.

Please give credits to:
- David Crocker (dc42) with his "least squares" calibration algorithm:
http://www.escher3d.com/pages/wizards/wizarddelta.php
- Gene Buckle (geneb) with his original plugin:
https://github.com/geneb/OctoPrint-Delta-Calibration
- Marc Hannappel (salandora) with his EEprom editor for Repetier firmware:
https://github.com/Salandora/OctoPrint-EEprom-Repetier
- Marc Ponschab (ponschab) with his Delta Calibration plugin forked from Gene Buckle's repository which give me some ideas:
https://github.com/ponschab/OctoPrint-Delta-Calibration

I owned them code. I've known almost nothing about any languages that can be used to implement Octoprint's plugin, now it's from almost nothing to a little bit :D

To use this plugin, you can install it using pip from a shell prompt:

    pip install https://github.com/hanhha/OctoPrint-Delta-Calibration/archive/master.zip

If you're working with an OctoPi distribution, you can sign into the "pi" account and
install the plugin this way:

    /home/pi/oprint/bin/pip install https://github.com/hanhha/OctoPrint-Delta-Calibration/archive/master.zip

In order to use the plugin, click on the Settings link in OctoPrint and then click on the
"Delta Autocalibration" link that's listed in the Plugins pane on the lower left. Then perform following steps in order (you will not be able to do in different order, only suitable buttons would be enabled):
- Click "Validate Z Max" button to measure real Z Max Height.
- Click "Load EEprom" button to load printer's parameters from EEProm.
- Click "Begin Delta Calibration" button to start calibration process, or "Check Delta Calibration" to verify the tolerance.

My limited knowledge about Javascript is not enough to implement doing all steps in one button :D 
Enjoy.

