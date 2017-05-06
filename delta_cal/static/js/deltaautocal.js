$(function () {
  "use strict";
  function DeltaAutoCalViewModel(parameters) {
    var self = this;
    self.control = parameters[0];
    self.connection = parameters[1];

    self.firmwareRegEx = /FIRMWARE_NAME:([^\s]+)/i;
    self.repetierRegEx = /Repetier_([^\s]*)/i;

    self.eepromDataRegEx = /EPR:(\d+) (\d+) ([^\s]+) (.+)/;

    // this creates functions that can be set here in code and can be referenced
    // externally via the jinja2 file.
    self.isRepetierFirmware = ko.observable(false);
    self.isEepromLoaded = ko.observable(false);
    self.EepromCnt = 0;

    self.eepromData = ko.observableArray([]);

    self.statusMessage = ko.observable("");
    self.statusCalResult = ko.observable("");

    self.isNotWorking = ko.observable(true);
    self.isHomeHeighValidated = ko.observable(false);

    // Calibration parameters
    self.probePoints = ko.observable(10);
    self.calibrationFactors = ko.observable(6);
    self.probeRadius = ko.observable(60);

    // Delta Calibration variables.
    self.probingActive = false;
    self.probeCount = 0;  // so we can keep track of what probe iteration we're on.
    self.commandText = "";  // where the commands to fix things will go for display purposes.

    self.calibrationComplete = false;

    var oldDeviation = 0.0;
    var newDeviation = 0.0;

    var ZProbeXOffset = 0.0;
    var ZProbeYOffset = 0.0;
    var ZProbeHeight = 0.0;
    var ZProbeBeddist = 5.0;
    var ZProbeXYSpeed = 40.0;

    var initialPoints = function () {
      return self.probePoints();
    }

    var initialFactors = function () {
      return self.calibrationFactors(); 
    }

    var ZProbeHeightAdjust = function () {
      return ZProbeHeight + ZProbeBeddist;
    }

    // Stage control
    // 0 - Idle
    // 1 - Get Eeprom
    // 2 - Get real central home height
    // 3 - Check tolerance
    // 4 - Calibration
    // Possible flows:
    //   0 -> 1 -> 2 -> 3 -> 0
    //   0 -> 1 -> 2 -> 4 -> 0
    var stOp = 0; 

    // dc42 code
    var deltaParams;
    var firmware = "Repetier";
    var bedRadius;
    var numPoints, numFactors;
    var normalise = true; // default from the webpage
    var xBedProbePoints = [];
    var yBedProbePoints = [];
    var zBedProbePoints = [];

    // these are used soley to populate those bits used by the setParameters() routine.
    var oldRodLength = 0;
    var oldRadius = 0;
    var oldHomedHeight = 0;
    var oldAStop = 0;
    var oldBStop = 0;
    var oldCStop = 0;
    var oldAPos = 0;
    var oldBPos = 0;
    var oldCPos = 0;
    var stepsPerMM = 0;

    var newAStop = 0.0;
    var newBStop = 0.0;
    var newCStop = 0.0;
    var newRodLength = 0.0;
    var newRadius = 0.0;
    var newHomedHeight = 0.0;
    var newAPos = 0.0;
    var newBPos = 0.0;
    var newCPos = 0.0;

    var m665 = "";
    var m666 = "";

    var degreesToRadians = Math.PI / 180.0;

    function fsquare(x) {
      return x * x;
    }

    var Matrix = function (rows, cols) {
      this.data = [];
      for (var i = 0; i < rows; ++i) {
        var row = [];
        for (var j = 0; j < cols; ++j) {
          row.push(0.0);
        }
        this.data.push(row)
      }
    }

    Matrix.prototype.SwapRows = function (i, j, numCols) {
      if (i != j) {
        for (var k = 0; k < numCols; ++k) {
          var temp = this.data[i][k];
          this.data[i][k] = this.data[j][k];
          this.data[j][k] = temp;
        }
      }
    }

    // Perform Gauus-Jordan elimination on a matrix with numRows rows and (njumRows + 1) columns
    Matrix.prototype.GaussJordan = function (solution, numRows) {
      for (var i = 0; i < numRows; ++i) {
        // Swap the rows around for stable Gauss-Jordan elimination
        var vmax = Math.abs(this.data[i][i]);
        for (var j = i + 1; j < numRows; ++j) {
          var rmax = Math.abs(this.data[j][i]);
          if (rmax > vmax) {
            this.SwapRows(i, j, numRows + 1);
            vmax = rmax;
          }
        }

        // Use row i to eliminate the ith element from previous and subsequent rows
        var v = this.data[i][i];
        for (var j = 0; j < i; ++j) {
          var factor = this.data[j][i] / v;
          this.data[j][i] = 0.0;
          for (var k = i + 1; k <= numRows; ++k) {
            this.data[j][k] -= this.data[i][k] * factor;
          }
        }

        for (var j = i + 1; j < numRows; ++j) {
          var factor = this.data[j][i] / v;
          this.data[j][i] = 0.0;
          for (var k = i + 1; k <= numRows; ++k) {
            this.data[j][k] -= this.data[i][k] * factor;
          }
        }
      }

      for (var i = 0; i < numRows; ++i) {
        solution.push(this.data[i][numRows] / this.data[i][i]);
      }
    }

    Matrix.prototype.Print = function (tag) {
      // We don't use this...
      var rslt = tag + " {<br/>";
      for (var i = 0; i < this.data.length; ++i) {
        var row = this.data[i];
        rslt += (row == 0) ? '{' : ' ';
        for (var j = 0; j < row.length; ++j) {
          rslt += row[j].toFixed(4);
          if (j + 1 < row.length) {
            rslt += ", ";
          }
        }
        rslt += '<br/>';
      }
      rslt += '}';
      return rslt;
    }

    var DeltaParameters = function (diagonal, radius, height, astop, bstop, cstop, aadj, badj, cadj) {
      this.diagonal = diagonal;
      this.radius = radius;
      this.homedHeight = height;
      this.astop = astop;
      this.bstop = bstop;
      this.cstop = cstop;
      this.aadj = aadj;
      this.badj = badj;
      this.cadj = cadj;
      this.Recalc();
    }

    DeltaParameters.prototype.Transform = function (machinePos, axis) {
      return machinePos[2] + Math.sqrt(this.D2 - fsquare(machinePos[0] - this.towerX[axis]) - fsquare(machinePos[1] - this.towerY[axis]));
    }

    // Inverse transform method, We only need the Z component of the result.
    DeltaParameters.prototype.InverseTransform = function (Ha, Hb, Hc) {
      var Fa = this.coreFa + fsquare(Ha);
      var Fb = this.coreFb + fsquare(Hb);
      var Fc = this.coreFc + fsquare(Hc);

      // Setup PQRSU such that x = -(S - uz)/P, y = (P - Rz)/Q
      var P = (this.Xbc * Fa) + (this.Xca * Fb) + (this.Xab * Fc);
      var S = (this.Ybc * Fa) + (this.Yca * Fb) + (this.Yab * Fc);

      var R = 2 * ((this.Xbc * Ha) + (this.Xca * Hb) + (this.Xab * Hc));
      var U = 2 * ((this.Ybc * Ha) + (this.Yca * Hb) + (this.Yab * Hc));

      var R2 = fsquare(R), U2 = fsquare(U);

      var A = U2 + R2 + this.Q2;
      var minusHalfB = S * U + P * R + Ha * this.Q2 + this.towerX[0] * U * this.Q - this.towerY[0] * R * this.Q;
      var C = fsquare(S + this.towerX[0] * this.Q) + fsquare(P - this.towerY[0] * this.Q) + (fsquare(Ha) - this.D2) * this.Q2;

      var rslt = (minusHalfB - Math.sqrt(fsquare(minusHalfB) - A * C)) / A;
      if (isNaN(rslt)) {
        throw "At least one probe point is not reachable. Please correct your delta radius, diagonal rod length, or probe coordinates."
      }
      return rslt;
    }

    DeltaParameters.prototype.Recalc = function () {
      this.towerX = [];
      this.towerY = [];
      this.towerX.push(-(this.radius * Math.cos((30 + this.aadj) * degreesToRadians)));
      this.towerY.push(-(this.radius * Math.sin((30 + this.aadj) * degreesToRadians)));
      this.towerX.push(+(this.radius * Math.cos((30 - this.badj) * degreesToRadians)));
      this.towerY.push(-(this.radius * Math.sin((30 - this.badj) * degreesToRadians)));
      this.towerX.push(-(this.radius * Math.sin(this.cadj * degreesToRadians)));
      this.towerY.push(+(this.radius * Math.cos(this.cadj * degreesToRadians)));

      this.Xbc = this.towerX[2] - this.towerX[1];
      this.Xca = this.towerX[0] - this.towerX[2];
      this.Xab = this.towerX[1] - this.towerX[0];
      this.Ybc = this.towerY[2] - this.towerY[1];
      this.Yca = this.towerY[0] - this.towerY[2];
      this.Yab = this.towerY[1] - this.towerY[0];
      this.coreFa = fsquare(this.towerX[0]) + fsquare(this.towerY[0]);
      this.coreFb = fsquare(this.towerX[1]) + fsquare(this.towerY[1]);
      this.coreFc = fsquare(this.towerX[2]) + fsquare(this.towerY[2]);
      this.Q = 2 * (this.Xca * this.Yab - this.Xab * this.Yca);
      this.Q2 = fsquare(this.Q);
      this.D2 = fsquare(this.diagonal);

      // Calculate the base carriage height when the printer is homed.
      var tempHeight = this.diagonal;    // any sensible height will do here, probably even zero
      this.homedCarriageHeight = this.homedHeight + tempHeight - this.InverseTransform(tempHeight, tempHeight, tempHeight);
    }

    DeltaParameters.prototype.ComputeDerivative = function (deriv, ha, hb, hc) {
      var perturb = 0.2;      // perturbation amount in mm or degrees
      var hiParams = new DeltaParameters(this.diagonal, this.radius, this.homedHeight, this.astop, this.bstop, this.cstop, this.aadj, this.badj, this.cadj);
      var loParams = new DeltaParameters(this.diagonal, this.radius, this.homedHeight, this.astop, this.bstop, this.cstop, this.aadj, this.badj, this.cadj);
      switch (deriv) {
        case 0:
        case 1:
        case 2:
          break;

        case 3:
          hiParams.radius += perturb;
          loParams.radius -= perturb;
          break;

        case 4:
          hiParams.aadj += perturb;
          loParams.aadj -= perturb;
          break;

        case 5:
          hiParams.badj += perturb;
          loParams.badj -= perturb;
          break;

        case 6:
          hiParams.diagonal += perturb;
          loParams.diagonal -= perturb;
          break;
      }

      hiParams.Recalc();
      loParams.Recalc();

      var zHi = hiParams.InverseTransform((deriv == 0) ? ha + perturb : ha, (deriv == 1) ? hb + perturb : hb, (deriv == 2) ? hc + perturb : hc);
      var zLo = loParams.InverseTransform((deriv == 0) ? ha - perturb : ha, (deriv == 1) ? hb - perturb : hb, (deriv == 2) ? hc - perturb : hc);

      return (zHi - zLo) / (2 * perturb);
    }

    // Make the average of the endstop adjustments zero, or make all emndstop corrections negative, without changing the individual homed carriage heights
    DeltaParameters.prototype.NormaliseEndstopAdjustments = function () {
      var eav = (firmware == "Marlin" || firmware == "MarlinRC" || firmware == "Repetier") ? Math.min(this.astop, Math.min(this.bstop, this.cstop))
        : (this.astop + this.bstop + this.cstop) / 3.0;
      this.astop -= eav;
      this.bstop -= eav;
      this.cstop -= eav;
      this.homedHeight += eav;
      this.homedCarriageHeight += eav;        // no need for a full recalc, this is sufficient
    }

    // Perform 3, 4, 6 or 7-factor adjustment.
    // The input vector contains the following parameters in this order:
    //  X, Y and Z endstop adjustments
    //  If we are doing 4-factor adjustment, the next argument is the delta radius. Otherwise:
    //  X tower X position adjustment
    //  Y tower X position adjustment
    //  Z tower Y position adjustment
    //  Diagonal rod length adjustment
    DeltaParameters.prototype.Adjust = function (numFactors, v, norm) {
      var oldCarriageHeightA = this.homedCarriageHeight + this.astop;  // save for later

      // Update endstop adjustments
      this.astop += v[0];
      this.bstop += v[1];
      this.cstop += v[2];
      if (norm) {
        this.NormaliseEndstopAdjustments();
      }

      if (numFactors >= 4) {
        this.radius += v[3];

        if (numFactors >= 6) {
          this.aadj += v[4];
          this.badj += v[5];

          if (numFactors == 7) {
            this.diagonal += v[6];
          }
        }

        this.Recalc();
      }

      // Adjusting the diagonal and the tower positions affects the homed carriage height.
      // We need to adjust homedHeight to allow for this, to get the change that was requested in the endstop corrections.
      var heightError = this.homedCarriageHeight + this.astop - oldCarriageHeightA - v[0];
      this.homedHeight -= heightError;
      this.homedCarriageHeight -= heightError;
    }

    function PrintVector(label, v) {
      var rslt = label + ": {";
      for (var i = 0; i < v.length; ++i) {
        rslt += v[i].toFixed(4);
        if (i + 1 != v.length) {
          rslt += ", ";
        }
      }
      rslt += "}";
      return rslt;
    }

    function calcProbePoints() {
      if (numPoints == 4) {
        for (var i = 0; i < 3; ++i) {
          xBedProbePoints[i] = (bedRadius * Math.sin((2 * Math.PI * i) / 3)).toFixed(2);
          yBedProbePoints[i] = (bedRadius * Math.cos((2 * Math.PI * i) / 3)).toFixed(2);
          zBedProbePoints[i] = 0.0;
        }
        xBedProbePoints[3] = 0.0;
        yBedProbePoints[3] = 0.0;
        zBedProbePoints[3] = 0.0;
      }
      else {
        if (numPoints >= 7) {
          for (var i = 0; i < 6; ++i) {
            xBedProbePoints[i] = (bedRadius * Math.sin((2 * Math.PI * i) / 6)).toFixed(2);
            yBedProbePoints[i] = (bedRadius * Math.cos((2 * Math.PI * i) / 6)).toFixed(2);
            zBedProbePoints[i] = 0.0;
          }
        }
        if (numPoints >= 10) {
          for (var i = 6; i < 9; ++i) {
            xBedProbePoints[i] = (bedRadius / 2 * Math.sin((2 * Math.PI * (i - 6)) / 3)).toFixed(2);
            yBedProbePoints[i] = (bedRadius / 2 * Math.cos((2 * Math.PI * (i - 6)) / 3)).toFixed(2);
            zBedProbePoints[i] = 0.0;
          }
          xBedProbePoints[9] = 0.0;
          yBedProbePoints[9] = 0.0;
          zBedProbePoints[9] = 0.0;
        }
        else {
          xBedProbePoints[6] = 0.0;
          yBedProbePoints[6] = 0.0;
          zBedProbePoints[6] = 0.0;
        }
      }
    }

    function setParameters() {

      // assign the initial values we need to get started.

      var eepromData = self.eepromData();
      _.each(eepromData, function (data) {
        switch (data.position) {
          case "11": // Steps per mm
            stepsPerMM = parseFloat(data.value);
            break;

          case "929": // Max. z-probe - bed dist
            ZProbeBeddist = parseFloat(data.value);
            break;

          case "808": // Z-Probe height
            ZProbeHeight = parseFloat(data.value);
            break;

          case "800": // Z-Probe X offset 
            ZProbeXOffset = parseFloat(data.value);
            break;

          case "804": // Z-Probe Y offset
            ZProbeYOffset = parseFloat(data.value);
            break;

          case "840": // Z-probe x-y speed
            ZProbeXYSpeed = parseFloat(data.value);
            break;

          case "925": // Bed Radius 
            bedRadius = parseFloat(data.value);
            break;

          case "153":   // Max Z height
            oldHomedHeight = parseFloat(data.value);
            console.log("Starting Homed Height: " + oldHomedHeight);
            break;

          case "881":  // Diagonal Rod length
            oldRodLength = parseFloat(data.value);
            console.log("Starting Diagonal Rod Length: " + oldRodLength);
            break;

          case "885":  // Diagonal Radius
            oldRadius = parseFloat(data.value);
            console.log("Starting Diagonal Radius: " + oldRadius);
            break;

          case "893":   // A Endstop offset
            oldAStop = parseInt(data.value);
            console.log("Starting A Endstop offset: " + oldAStop);
            break;

          case "895":   // Y Endstop offset
            oldBStop = parseInt(data.value);
            console.log("Starting Y Endstop offset: " + oldBStop);
            break;

          case "897":   // Z Endstop offset
            oldCStop = parseInt(data.value);
            console.log("Starting Z Endstop offset: " + oldCStop);
            break;

          case "901":  // X Tower Rotation offset
            oldAPos = parseFloat(data.value - 210.00);
            console.log("Starting X Pos. Offset: " + oldAPos);
            break;

          case "905":  // Y Tower Rotation offset
            oldBPos = parseFloat(data.value - 330.00);
            console.log("Starting Y Pos. Offset: " + oldBPos);
            break;

          case "909":  // Z Tower rotation offset
            oldCPos = parseFloat(data.value - 90.00);
            console.log("Starting Y Pos. Offset: " + oldCPos);
            break;

          default:
            break;
        }
      });

      deltaParams = new DeltaParameters(oldRodLength, oldRadius, oldHomedHeight,
          oldAStop, oldBStop, oldCStop, oldAPos, oldBPos, oldCPos);
      if (self.probeRadius() != 0) {
        bedRadius = self.probeRadius();
      }
      self.statusMessage("Probe radius is " + bedRadius);
      console.log(self.statusMessage());

      calcProbePoints();
    }

    function convertIncomingEndstops() {
      var endstopFactor = (firmware == "RRF") ? 1.0
        : (firmware == "Repetier") ? 1.0 / stepsPerMM
        : -1.0;
      deltaParams.astop *= endstopFactor;
      deltaParams.bstop *= endstopFactor;
      deltaParams.cstop *= endstopFactor;
    }

    function convertOutgoingEndstops() {
      var endstopFactor = (firmware == "RRF") ? 1.0
        : (firmware == "Repetier") ? (stepsPerMM)
        : -1.0;
      console.log("FW: " + firmware);
      deltaParams.astop *= endstopFactor;
      deltaParams.bstop *= endstopFactor;
      deltaParams.cstop *= endstopFactor;
    }

    function setNewParameters() {
      var endstopPlaces = (firmware == "Repetier") ? 0 : 2;
      newAStop = deltaParams.astop.toFixed(endstopPlaces);
      newBStop = deltaParams.bstop.toFixed(endstopPlaces);
      newCStop = deltaParams.cstop.toFixed(endstopPlaces);
      newRodLength = deltaParams.diagonal.toFixed(2);
      newRadius = deltaParams.radius.toFixed(2);
      newHomedHeight = deltaParams.homedHeight.toFixed(2);
      newAPos = deltaParams.aadj.toFixed(2);
      newBPos = deltaParams.badj.toFixed(2);
      newCPos = deltaParams.cadj.toFixed(2);
    }

    self.beginGetHomeProbe = function () {
      self.isNotWorking(false);
      self.probingActive = true;
      stOp = 2;
      console.log("G28");
      self.control.sendCustomCommand({ command: "G28" }); // home
      console.log("G29 S2");
      self.control.sendCustomCommand({ command: "G29 S2" }); // single z-probe at x0 y0 zMax first 
    }

    self.beginDeltaCal = function () {
      self.isNotWorking(false);
      numPoints = initialPoints();  // these should be configurable at some point.
      numFactors = initialFactors();
      self.statusCalResult("");

      firmware = "Repetier";
      // here's where we begin to accumulate the data needed to run the actual calculations.
      setParameters();  // develops our probing points.
      convertIncomingEndstops();

      // kick off the first probe!
      self.probeCount = 0;
      self.probingActive = true;
      console.log("G28");
      self.control.sendCustomCommand({ command: "G28" }); // home

      // build it all right now.
      stOp = 4;
      var strCommandBuffer = [];

      // temporarily variables
      var xProbePoint = 0.0;
      var yProbePoint = 0.0;
      var zProbePoint = 0.0;
      var ProbeXYFeedrate = ZProbeXYSpeed * 60;
      var cmd_strs = "";

      console.log("# of Probe points is " + numPoints);
      cmd_strs = "G0 X0 Y0 Z" + ZProbeHeightAdjust() + " F6000";
      console.log(cmd_strs);
      self.control.sendCustomCommand({ command: cmd_strs }); // go to ready line 

      for(var x = 0; x < numPoints; x++) {
        xProbePoint = xBedProbePoints[x] + ZProbeXOffset;
        yProbePoint = yBedProbePoints[x] + ZProbeYOffset;
        zProbePoint = zBedProbePoints[x] + ZProbeHeightAdjust();
        var cmd_strs = "G1 X"  + xProbePoint + " Y" + yProbePoint + " Z" + zProbePoint + " F" + ProbeXYFeedrate;
        console.log(cmd_strs);
        strCommandBuffer.push(cmd_strs);
        cmd_strs = "G30";
        console.log(cmd_strs);
        strCommandBuffer.push(cmd_strs);
      }
      self.control.sendCustomCommand({ commands: strCommandBuffer});
    }

    self.checkDeltaCal = function () {
      self.isNotWorking(false);
      numPoints = initialPoints();  // these should be configurable at some point.
      numFactors = initialFactors();
      self.statusCalResult("");

      firmware = "Repetier";
      // here's where we begin to accumulate the data needed to run the actual calculations.
      setParameters();  // develops our probing points.
      convertIncomingEndstops();

      // kick off the first probe!
      self.probeCount = 0;
      self.probingActive = true;
      console.log("G28");
      self.control.sendCustomCommand({ command: "G28" }); // home

      // build it all right now.
      stOp = 3;
      var strCommandBuffer = [];

      // temporarily variables
      var xProbePoint = 0.0;
      var yProbePoint = 0.0;
      var zProbePoint = 0.0;
      var ProbeXYFeedrate = ZProbeXYSpeed * 60;
      var cmd_strs = "";

      console.log("# of Probe points is " + numPoints);
      cmd_strs = "G0 X0 Y0 Z" + ZProbeHeightAdjust() + " F6000";
      console.log(cmd_strs);
      self.control.sendCustomCommand({ command: cmd_strs }); // go to ready line 

      for(var x = 0; x < numPoints; x++) {
        xProbePoint = xBedProbePoints[x] + ZProbeXOffset;
        yProbePoint = yBedProbePoints[x] + ZProbeYOffset;
        zProbePoint = zBedProbePoints[x] + ZProbeHeightAdjust();
        cmd_strs = "G1 X"  + xProbePoint + " Y" + yProbePoint + " Z" + zProbePoint + " F" + ProbeXYFeedrate;
        console.log(cmd_strs);
        strCommandBuffer.push(cmd_strs);
        cmd_strs = "G30";
        console.log(cmd_strs);
        strCommandBuffer.push(cmd_strs);
      }
      cmd_strs = "G28"; // home at the end
      console.log(cmd_strs);
      strCommandBuffer.push(cmd_strs);
      self.control.sendCustomCommand({ commands: strCommandBuffer});
    }

    function startDeltaCalcEngine() {

      try {
        var rslt = DoDeltaCalibration();
        self.probingActive = false; // all done!
        convertOutgoingEndstops();
        setNewParameters();

        if( oldDeviation != newDeviation ){
          //Hacky fix to get the adjustments to go the right way!
          var newAStop = Math.round(deltaParams.astop.toFixed(2));
          var newBStop = Math.round(deltaParams.bstop.toFixed(2));
          var newCStop = Math.round(deltaParams.cstop.toFixed(2));
          var newDiagonal = deltaParams.diagonal.toFixed(2);
          var newRadius = deltaParams.radius.toFixed(2);
          var newHomedHeight = deltaParams.homedHeight.toFixed(2);

          console.log("========================================")
            self.saveEEPROMData(1, "893", newAStop);
          console.log("A Stop offset is " + newAStop + " steps.");
          self.saveEEPROMData(1, "895", newBStop);
          console.log("B Stop offset is " + newBStop + " steps.");
          self.saveEEPROMData(1, "897", newCStop);
          console.log("C Stop offset is " + newCStop + " steps.");

          self.saveEEPROMData(3, "901", (210 + parseFloat(newAPos)));
          console.log("Corrected Alpha A(210) to " + (210 + parseFloat(newAPos)) + ".");
          self.saveEEPROMData(3, "905", (330 + parseFloat(newBPos)));
          console.log("Corrected Alpha B(330) to " + (330 + parseFloat(newBPos)) + ".");
          self.saveEEPROMData(3, "909", (90 + parseFloat(newCPos)));
          console.log("Corrected Alpha C(90) to  " + (90 + parseFloat(newCPos)) + ".");


          self.saveEEPROMData(3, "881", newDiagonal);
          console.log("Diagonal Rod: " + newDiagonal);
          self.saveEEPROMData(3, "885", newRadius);
          console.log("Horizontal Radius: " + newRadius);
          self.saveEEPROMData(3, "153", newHomedHeight);
          console.log("Max Z Height is now: " + newHomedHeight);

          self.control.sendCustomCommand({ command: "M500" });
          self.statusMessage("Success, changes written to EEPROM.");
          self.control.sendCustomCommand({ command: "G28" });
          console.log(self.statusMessage());
          self.isEepromLoaded(false);
        }else{
          self.statusMessage("New calibration is not measureably better than the old - keeping the old calibration");
        }
        self.calibrationComplete = true;
      }
      catch (err) {
        self.statusMessage(self.statusMessage() + "Error! - " + err);
        console.log("Error! - " + err);
      }
      stOp = 0;
      self.isNotWorking(true);
    }

    function DoDeltaCalibration() {
      if (numFactors != 3 && numFactors != 4 && numFactors != 6 && numFactors != 7) {
        self.statusMessage(self.statusMessage() + "Error: " + numFactors + " factors requested but only 3, 4, 6 and 7 supported");
        return;
      }
      if (numFactors > numPoints) {
        self.statusMessage(self.statusMessage() + "Error: need at least as many points as factors you want to calibrate");
        return;
      }

      // Transform the probing points to motor endpoints and store them in a matrix, so that we can do multiple iterations using the same data
      var probeMotorPositions = new Matrix(numPoints, 3);
      var corrections = new Array(numPoints);
      var initialSumOfSquares = 0.0;
      for (var i = 0; i < numPoints; ++i) {
        corrections[i] = 0.0;
        var machinePos = [];
        var xp = xBedProbePoints[i], yp = yBedProbePoints[i];
        machinePos.push(xp);
        machinePos.push(yp);
        machinePos.push(0.0);

        probeMotorPositions.data[i][0] = deltaParams.Transform(machinePos, 0);
        probeMotorPositions.data[i][1] = deltaParams.Transform(machinePos, 1);
        probeMotorPositions.data[i][2] = deltaParams.Transform(machinePos, 2);

        initialSumOfSquares += fsquare(zBedProbePoints[i]);
      }

      // Do 1 or more Newton-Raphson iterations
      var iteration = 0;
      var expectedRmsError;
      for (; ;) {
        // Build a Nx7 matrix of derivatives with respect to xa, xb, yc, za, zb, zc, diagonal.
        var derivativeMatrix = new Matrix(numPoints, numFactors);
        for (var i = 0; i < numPoints; ++i) {
          for (var j = 0; j < numFactors; ++j) {
            derivativeMatrix.data[i][j] =
              deltaParams.ComputeDerivative(j, probeMotorPositions.data[i][0], probeMotorPositions.data[i][1], probeMotorPositions.data[i][2]);
          }
        }

        // Now build the normal equations for least squares fitting
        var normalMatrix = new Matrix(numFactors, numFactors + 1);
        for (var i = 0; i < numFactors; ++i) {
          for (var j = 0; j < numFactors; ++j) {
            var temp = derivativeMatrix.data[0][i] * derivativeMatrix.data[0][j];
            for (var k = 1; k < numPoints; ++k) {
              temp += derivativeMatrix.data[k][i] * derivativeMatrix.data[k][j];
            }
            normalMatrix.data[i][j] = temp;
          }
          var temp = derivativeMatrix.data[0][i] * -(zBedProbePoints[0] + corrections[0]);
          for (var k = 1; k < numPoints; ++k) {
            temp += derivativeMatrix.data[k][i] * -(zBedProbePoints[k] + corrections[k]);
          }
          normalMatrix.data[i][numFactors] = temp;
        }

        var solution = [];
        normalMatrix.GaussJordan(solution, numFactors);

        for (var i = 0; i < numFactors; ++i) {
          if (isNaN(solution[i])) {
            throw "Unable to calculate corrections. Please make sure the bed probe points are all distinct.";
          }
        }

        deltaParams.Adjust(numFactors, solution, normalise);

        // Calculate the expected probe heights using the new parameters
        {
          var expectedResiduals = new Array(numPoints);
          var sumOfSquares = 0.0;
          for (var i = 0; i < numPoints; ++i) {
            for (var axis = 0; axis < 3; ++axis) {
              probeMotorPositions.data[i][axis] += solution[axis];
            }
            var newZ = deltaParams.InverseTransform(probeMotorPositions.data[i][0], probeMotorPositions.data[i][1], probeMotorPositions.data[i][2]);
            corrections[i] = newZ;
            expectedResiduals[i] = zBedProbePoints[i] + newZ;
            sumOfSquares += fsquare(expectedResiduals[i]);
          }

          expectedRmsError = Math.sqrt(sumOfSquares / numPoints);
        }

        // Decide whether to do another iteration Two is slightly better than one, but three doesn't improve things.
        // Alternatively, we could stop when the expected RMS error is only slightly worse than the RMS of the residuals.
        ++iteration;
        if (iteration == 2) { break; }
      }

      oldDeviation = Math.sqrt(initialSumOfSquares / numPoints).toFixed(2);
      newDeviation = expectedRmsError.toFixed(2);
      var infoStr = "Calibrated " + numFactors + " factors using " + numPoints + " points, deviation before: " + oldDeviation
        + " - after: " + newDeviation;
      console.log(infoStr);
      self.statusCalResult(infoStr);
    }

    ////////////////////////////////////////////////////////////////////////
    // End of dc42's code.
    ////////////////////////////////////////////////////////////////////////

    self.resetVariables = function () {
      // Reset all variables
      stOp = 0;
      self.statusMessage("");
      self.statusCalResult("");
      self.isRepetierFirmware(false);
      self.isEepromLoaded(false);
      self.isHomeHeighValidated(false);
      self.EepromCnt = 0;

      self.eepromData([]);


      self.isNotWorking(true);

      // Calibration parameters
      self.probePoints(10);
      self.calibrationFactors(6);

      // Delta Calibration variables.
      self.probingActive = false;
      self.probeCount = 0;  // so we can keep track of what probe iteration we're on.
      self.commandText = "";  // where the commands to fix things will go for display purposes.

      self.calibrationComplete = false;
    }

    function startDeltaCheckEngine() {

      try {
        var rslt = DoDeltaCheck();
        self.probingActive = false; // all done!
      }
      catch (err) {
        self.statusMessage(self.statusMessage() + "Error! - " + err);
        console.log("Error! - " + err);
      }
      stOp = 0;
      self.isNotWorking(true);
    }

    function DoDeltaCheck() {
      if (numFactors != 3 && numFactors != 4 && numFactors != 6 && numFactors != 7) {
        self.statusMessage(self.statusMessage() + "Error: " + numFactors + " factors requested but only 3, 4, 6 and 7 supported");
        return;
      }
      if (numFactors > numPoints) {
        self.statusMessage(self.statusMessage() + "Error: need at least as many points as factors you want to calibrate");
        return;
      }

      // Transform the probing points to motor endpoints and store them in a matrix, so that we can do multiple iterations using the same data
      var probeMotorPositions = new Matrix(numPoints, 3);
      var corrections = new Array(numPoints);
      var initialSumOfSquares = 0.0;
      for (var i = 0; i < numPoints; ++i) {
        corrections[i] = 0.0;
        var machinePos = [];
        var xp = xBedProbePoints[i], yp = yBedProbePoints[i];
        machinePos.push(xp);
        machinePos.push(yp);
        machinePos.push(0.0);

        probeMotorPositions.data[i][0] = deltaParams.Transform(machinePos, 0);
        probeMotorPositions.data[i][1] = deltaParams.Transform(machinePos, 1);
        probeMotorPositions.data[i][2] = deltaParams.Transform(machinePos, 2);

        initialSumOfSquares += fsquare(zBedProbePoints[i]);
      }

      oldDeviation = Math.sqrt(initialSumOfSquares / numPoints).toFixed(2);
      var infoStr = "Current tolerance of " + numPoints + " probe points is " + oldDeviation;
      console.log(infoStr);
      self.statusCalResult(infoStr);
    }

    self.onStartup = function () {
      $('#settings_plugin_delta_cal_link a').on('show', function (e) {
        self.resetVariables();
        if (self.isConnected())
          self._requestFirmwareInfo();
      });
    }

    self.fromHistoryData = function (data) {
      _.each(data.logs, function (line) {
        var match = self.firmwareRegEx.exec(line);
        if (match != null) {
          if (self.repetierRegEx.exec(match[0]))
            self.isRepetierFirmware(true);
        }
      });
    }

    self.fromCurrentData = function (data) {
      if (!self.isRepetierFirmware) {
        _.each(data.logs, function (line) {
          var match = self.firmwareRegEx.exec(line);
          if (match) {
            console.log("Firmware: " + line);
            if (self.repetierRegEx.exec(match[0])) {
              self.isRepetierFirmware(true);
            }
          }
        });
      }
      else {
        _.each(data.logs, function (line) {
          switch (stOp) {
            case 0:
              break;
            case 1: // Read EEPROM
              var match = self.eepromDataRegEx.exec(line);
              if (match) {
                switch (match[2]) {
                  case "11": // Steps per mm
                  case "808": // Z-Probe height
                  case "800": // Z-Probe X offset 
                  case "804": // Z-Probe Y offset
                  case "925": // Bed Radius 
                  case "153":   // Max Z height
                  case "881":  // Diagonal Rod length
                  case "885":  // Diagonal Radius
                  case "893":   // A Endstop offset
                  case "895":   // Y Endstop offset
                  case "897":   // Z Endstop offset
                  case "901":  // X Tower Rotation offset
                  case "905":  // Y Tower Rotation offset
                  case "909":  // Z Tower rotation offset
                  case "929": // Max. z-probe - bed dist
                  case "840": // Z-probe x-y speed
                    self.EepromCnt += 1;
                    self.eepromData.push({
                      dataType: match[1],
                      position: match[2],
                      origValue: match[3],
                      value: match[3],
                      description: match[4]
                    });
                    console.log("Desc: " + line);
                    break;
                  default:
                    break;
                }
                if (self.EepromCnt == 16) {
                  self.isEepromLoaded(true);
	          self.isNotWorking(true);
                }
              }
              break;
            case 2: // get real home height
              if (self.probingActive && line.includes("Printer height:")) {
                var zCoord = line.split(":");
                self.statusMessage("Current real home height is " + parseFloat(zCoord[2]));
                console.log("Current real home height is " + parseFloat(zCoord[2]));
                self.probingActive = false; // all done!
                self.isHomeHeighValidated(true);
	        self.isNotWorking(true);
              }
              break;
            case 3: // checking tolerance, not calibrating
              if (self.probingActive && line.includes("Z-probe:")) {
                var zCoord = line.split(":");
                self.statusMessage(self.statusMessage() + ".");
                console.log(" Probe #" + parseInt(self.probeCount + 1) + " value: " + parseFloat(zCoord[2]));
                zBedProbePoints[self.probeCount] = -(parseFloat(zCoord[2]) - ZProbeHeightAdjust());
                self.probeCount++;
                if (self.probeCount == numPoints) {
                  startDeltaCheckEngine();
                }
              }
              break;
            case 4: // calibrating
              if (self.probingActive && line.includes("Z-probe:")) {
                var zCoord = line.split(":");
                self.statusMessage(self.statusMessage() + ".");
                console.log(" Probe #" + parseInt(self.probeCount + 1) + " value: " + parseFloat(zCoord[2]));
                zBedProbePoints[self.probeCount] = -(parseFloat(zCoord[2]) - ZProbeHeightAdjust());
                self.probeCount++;
                if (self.probeCount == numPoints) {
                  startDeltaCalcEngine();  // doooo eeeeeeet!
                }
              }
              break;
            default:
              break;
          }
        });
      }
    }

    self.isConnected = ko.computed(function () {
      return self.connection.isOperational() || self.connection.isPrinting() ||
        self.connection.isReady() || self.connection.isPaused();
    });

    self.onEventConnected = function () {
      self.resetVariables();
      self._requestFirmwareInfo();
    }

    self.onEventDisconnected = function () {
      self.isRepetierFirmware(false);
    }

    self.saveEEPROMData = function (data_type, position, value) {
      var cmd = "M206 T" + data_type + " P" + position;
      if (data_type == 3) {
        cmd += " X" + value;
        console.log("Sent EEPROM command: " + cmd);
        self.control.sendCustomCommand({ command: cmd });
      }
      else {
        cmd += " S" + value;
        //console.log("Sent EEPROM command: " + cmd);
        self.control.sendCustomCommand({ command: cmd });
      }
    }

    self.loadEEProm = function () {
      self.eepromData([]);
      self.EepromCnt = 0;
      stOp = 1;
      self.isNotWorking(false);
      self.isEepromLoaded(false);
      self.readEEPROMData();
    }

    self._requestFirmwareInfo = function () {
      self.control.sendCustomCommand({ command: "M115" });
    }

    self.readEEPROMData = function () {
      self.control.sendCustomCommand({ command: "M205" });
    }
  }

  OCTOPRINT_VIEWMODELS.push([ DeltaAutoCalViewModel, ["controlViewModel", "connectionViewModel"], "#settings_plugin_delta_cal" ]);

});
