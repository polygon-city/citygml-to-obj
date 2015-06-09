var _ = require("lodash");
var async = require("async");
var fs = require("fs-extra");
var path = require("path");
var sax = require("sax");
var saxpath = require("saxpath");
var DOMParser = require("xmldom").DOMParser;
var strict = true;
var UUID = require("uuid");

// CityGML helpers
var citygmlSRS = require("citygml-srs");
var citygmlPolygons = require("citygml-polygons");
var citygmlBoundaries = require("citygml-boundaries");
var citygmlPoints = require("citygml-points");
var citygmlValidateShell = require("citygml-validate-shell");

// Other helpers
var polygons2obj = require("polygons-to-obj");
var triangulate = require("triangulate");

var domParser = new DOMParser();

var processQueue;
var saveQueue;

// TODO: Look into batching and threads to improve reliability and performance

var citygmlToObj = function(citygmlPath, objPath) {
  // SRS
  var envelopeSRS;

  processQueue = async.queue(processBuilding, 10);
  saveQueue = async.queue(saveFile, 5);

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

  var saxStreamEnvelope = new saxpath.SaXPath(saxParser, "//gml:Envelope");

  saxStreamEnvelope.on("match", function(xml) {
    var srs = citygmlSRS(xml);

    if (srs) {
      envelopeSRS = srs;
    }

    // No need to kill the stream as it's still used to find buildings
    // readStream.destroy();
  });

  var saxStream = new saxpath.SaXPath(saxParser, "//bldg:Building");

  saxStream.on("match", function(xml) {
    processQueue.push({
      xml: xml,
      srs: envelopeSRS,
      objPath: objPath
    });
  });

  saxStream.on("end", function() {});

  var readStream = fs.createReadStream(citygmlPath);
  readStream.pipe(saxParser);
};

var processBuilding = function(data, pCallback) {
  var srs = (data.srs) ? data.srs : citygmlSRS(data.xml);

  if (!srs) {
    console.error("Failed to find SRS for building");
    console.log(data.xml.toString());
    return;
  }

  var xmlDOM = domParser.parseFromString(data.xml);

  var id = xmlDOM.firstChild.getAttribute("gml:id") || UUID.v4();

  var polygonsGML = citygmlPolygons(data.xml);
  var allPolygons = [];

  _.each(polygonsGML, function(polygonGML) {
    // Get exterior and interior boundaries for polygon (outer and holes)
    var boundaries = citygmlBoundaries(polygonGML);

    // Get vertex points for the exterior boundary
    var points = citygmlPoints(boundaries.exterior[0]);

    allPolygons.push(points);
  });

  // Process control
  async.waterfall([function(callback) {
    // Validate CityGML
    citygmlValidateShell(polygonsGML, function(err, results) {
      callback(err, results);
    });
  }, function(results, callback) {
    // Repair CityGML
    // TODO: Revalidate and repair after each repair, as geometry will change
    var polygonsCopy = _.clone(allPolygons);

    // Face flipping
    var flipFaces = [];

    _.each(results, function(vError) {
      // Should always be an error, but check anyway
      if (!vError || !vError[0]) {
        return;
      }

      // Failure indexes, for repair
      var vIndices = vError[1];

      // Output validation error name
      switch (vError[0].message.split(":")[0]) {
        case "GE_S_POLYGON_WRONG_ORIENTATION":
        case "GE_S_ALL_POLYGONS_WRONG_ORIENTATION":
          // TODO: Work out why reversing the vertices doesn't flip the
          // normal so we can fix things that way
          _.each(vIndices, function(vpIndex) {
            var points = polygonsCopy[vpIndex];

            // REMOVED: Until it can be worked out why reversing doesn't
            // actually flip the normal in this case (it should)
            // polygonsCopy[vpIndex].reverse();

            // Add face to be flipped
            flipFaces.push(vpIndex);
          });

          break;
      }
    });

    callback(null, polygonsCopy, flipFaces);
  }, function(polygons, flipFaces, callback) {
    // Triangulate
    var allFaces = [];

    // TODO: Support polygons with holes
    _.each(polygons, function(polygon, pIndex) {
      // Triangulate faces
      try {
        var faces = triangulate(polygon);

        // Flip incorrect faces
        if (_.contains(flipFaces, pIndex)) {
          _.each(faces, function(face) {
            face.reverse();
          });
        }

        allFaces.push(faces);
      } catch(err) {
        console.error("Unable to triangulate:", id, err);
        callback(err, id);
      }
    });

    callback(null, polygons, allFaces);
  }, function(polygons, faces, callback) {
    // Create OBJ using polygons and faces
    // NOTE: Disabled zUP until face normals issues is fixed. The 3DCityDB
    // Collada output doesn't use zUP either anyway, so this is no worse.
    var objStr = polygons2obj(polygons, faces, false);

    callback(null, objStr);
  }, function(objStr, callback) {
    // Save OBJ file
    var outputPath = path.join(data.objPath, id + ".obj");

    saveQueue.push({
      path: outputPath,
      data: objStr
    }, function(err) {
      console.log("Saved:", outputPath);
      pCallback(null);
    });
  }], function(err) {
    if (err) {
      console.error("Unable to convert building:", id);
    }
  });
};

var saveFile = function(output, callback) {
  fs.outputFile(output.path, output.data, function(err) {
    callback(err);
  });
};

module.exports = citygmlToObj;
