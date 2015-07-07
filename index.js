var _ = require("lodash");
var childProcess = require("child_process");
var fs = require("fs-extra");
var sax = require("sax");
var saxpath = require("saxpath");
var strict = true;

var numCPUs = require("os").cpus().length;

var shutdown = false;

// CityGML helpers
var citygmlSRS = require("citygml-srs");

var workers = {};
var processQueue = [];

// TODO: Look into batching and threads to improve reliability and performance

// Create a new worker for each CPU
for (var i = 0; i < numCPUs; i++) {
  var worker = childProcess.fork(__dirname + "/worker");

  workers[worker.pid] = {
    process: worker,
    ready: true,
    alive: true
  };

  // Be notified when worker processes die.
  worker.on("exit", function() {
    workers[this.pid].alive = false;
  });

  // Receive messages from this worker and handle them in the master process.
  worker.on("message", function(msg) {
    if (msg.finished) {
      if (shutdown) {
        this.kill("SIGINT");
      }

      workers[this.pid].ready = true;
    }
  });
}

var processingQueue = false;

var updateQueue = function() {
  if (processingQueue) {
    return;
  }

  processingQueue = true;
  processWorkers();
  processingQueue = false;
};

var processWorkers = function() {
  _.each(workers, function(worker, pid) {
    if (processQueue.length === 0) {
      return false;
    }

    if (worker.ready) {
      worker.ready = false;

      var item = processQueue.shift();
      worker.process.send(item);
    }
  });
};

var citygmlToObj = function(citygmlPath, objPath, proj4def, bingKey, callback) {
  if (!proj4def) {
    callback(new Error("Failed to find proj4 definition for building: ", citygmlPath));
    return;
  }

  if (!bingKey) {
    callback(new Error("Bing API key is required"));
    return;
  }

  var saxParser = sax.createStream(strict, {
    xmlns: true
  });

  var streamErrorHandler = function (e) {
    console.error("Error:", e);

    // Clear the error
    // TODO: Check this is how sax-js recommends error handling
    this._parser.error = null;
    this._parser.resume();
  };

  saxParser.on("error", streamErrorHandler);

  // REMOVED: SRS logic replaced with user-defined proj4 definition
  //
  // var saxStreamEnvelope = new saxpath.SaXPath(saxParser, "//gml:Envelope");
  //
  // saxStreamEnvelope.on("match", function(xml) {
  //   var srs = citygmlSRS(xml);
  //
  //   if (srs) {
  //     envelopeSRS = srs;
  //   }
  //
  //   // No need to kill the stream as it's still used to find buildings
  //   // readStream.destroy();
  // });

  var saxStream = new saxpath.SaXPath(saxParser, "//bldg:Building");

  saxStream.on("match", function(xml) {
    processQueue.push({
      xml: xml,
      proj4def: proj4def,
      bingKey: bingKey,
      objPath: objPath
    });
  });

  saxStream.on("end", function() {
    shutdown = true;

    // Stop update check
    clearInterval(queueCheck);

    // Update queue one last time
    updateQueue();

    // Clean up unused workers
    // Keep the currently active worker open until it's finished
    _.each(workers, function(worker) {
      if (worker.ready) {
        worker.process.kill("SIGINT");
      }
    });

    if (callback) {
      callback();
    }
  });

  var readStream = fs.createReadStream(citygmlPath);
  readStream.pipe(saxParser);
};

var queueCheck = setInterval(updateQueue, 50);

module.exports = citygmlToObj;
