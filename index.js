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

var readStream;

var workers = {};
var processQueue = [];
var maxQueue = 30;
var queueCheck;

// TODO: Look into batching and threads to improve reliability and performance

var createWorkers = function() {
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
        if (msg.err) {
          console.error(msg.err);
        }

        if (shutdown) {
          this.kill("SIGINT");
        }

        workers[this.pid].ready = true;
      }
    });
  }
};

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

      // Resume queue when space is available
      if (processQueue.length < maxQueue && readStream.isPaused()) {
        console.log("Resuming queue");
        readStream.resume();
      }
    }
  });
};

var citygmlToObj = function(options, callback) {
  if (!options) {
    options = {};
  }

  var defaults = {
    overwrite: false
  };

  // Set defaults
  _.defaults(options, defaults);

  if (!options.citygmlPath) {
    callback(new Error("CityGML path is required"));
    return;
  }

  if (!options.objPath) {
    callback(new Error("OBJ path is required: ", citygmlPath));
    return;
  }

  if (!options.proj4def) {
    callback(new Error("Proj4 definition is required: ", citygmlPath));
    return;
  }

  // Set up workers
  if (_.isEmpty(workers)) {
    createWorkers();
    queueCheck = setInterval(updateQueue, 50);
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
      proj4def: options.proj4def,
      objPath: options.objPath,
      overwrite: options.overwrite
    });

    // Pause stream if queue is too large
    if (processQueue.length >= maxQueue && !readStream.isPaused()) {
      console.log("Pausing queue");
      readStream.pause();
    }
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

  readStream = fs.createReadStream(options.citygmlPath);
  readStream.pipe(saxParser);
};

module.exports = citygmlToObj;
