This is a plugin for the 3D printer host software, OctoPrint (http://www.octoprint.org).

This plugin is forked from the Delta Auto Calibration plugin which is dedicated for delta printers manufactured by SeeMeCNC (http://www.seemecnc.com) to support original Repetier firmware. Please give credit to:
Geneb with his original plugin:
https://github.com/geneb/OctoPrint-Delta-Calibration
dc42 with his "least squares" calibration algorithm:
http://www.escher3d.com/pages/wizards/wizarddelta.php.  His calibration routines are also found

To use this plugin, you can install it using pip from a shell prompt:

    pip install https://github.com/hanhha/OctoPrint-Delta-Calibration/archive/master.zip

If you're working with an OctoPi distribution, you can sign into the "pi" account and
install the plugin this way:

    /home/pI/oprint/bin/pip install https://github.com/hanhha/OctoPrint-Delta-Calibration/archive/master.zip

Before running this utility on your printer, you should issue a G29 command via the OctoPrint
terminal.  This will kick off the internal calibration and will get the Z height properly set.

In order to use the plugin, click on the Settings link in OctoPrint and then click on the
"Delta Autocalibration" link that's listed in the Plugins pane on the lower left.

Click the Load EEPROM button and then click the Begin Delta Calibration button.

You may run it as many times as you like, but you MUST click the Load EEPROM button before you begin
the calibration sequence!  If you fail to do this, the calibration routine will NOT know what the current
parameters are and you'll get poor, bad, or moderately catastrophic results.

Enjoy!

