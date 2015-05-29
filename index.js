var _ = require("lodash");
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

// Other helpers
var polygons2obj = require("polygons-to-obj");
var triangulate = require("triangulate");

var domParser = new DOMParser();

var citygmlToObj = function(citygmlPath, objPath) {
  // SRS
  var envelopeSRS;

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

  // DEBUG: Only output certain number of buildings
  // var buildingCount = 0;
  // var maxBuildings = 10;

  saxStream.on("match", function(xml) {
    // Kill stream
    // if (++buildingCount >= maxBuildings) {
    //   return;
    //   // readStream.destroy();
    // }

    var srs = (envelopeSRS) ? envelopeSRS : citygmlSRS(xml);

    if (!srs) {
      console.error("Failed to find SRS for building");
      console.log(xml.toString());
      return;
    }

    var xmlDOM = domParser.parseFromString(xml);

    var id = xmlDOM.firstChild.getAttribute("gml:id") || UUID.v4();

    var polygons = citygmlPolygons(xml);

    var allPolygons = [];
    var allFaces = [];

    // TODO: Support polygons with holes
    _.each(polygons, function(polygon) {
      // Get exterior and interior boundaries for polygon (outer and holes)
      var boundaries = citygmlBoundaries(polygon);

      // Get vertex points for the exterior boundary
      var points = citygmlPoints(boundaries.exterior[0]);

      // Triangulate faces
      var faces = triangulate(points);

      allPolygons.push(points);
      allFaces.push(faces);
    });

    // Create OBJ using polygons and faces
    var objStr = polygons2obj(allPolygons, allFaces, true);
    // console.log(objStr);

    var outputPath = path.join(objPath, id + ".obj");

    // TODO: Fix huge delay before these small files appear in the filesystem when using fsextra.outputFile
    // - Possibly a local issue with my filesystem rather than a Node or app issue
    // - Perhaps batching will help, as well as deferring saving until CityGML buffer processing is complete
    fs.outputFile(outputPath, objStr, function(err) {
      if (err) {
        console.error(err);
      }

      // console.log("Saved:", id);
    });
  });

  saxStream.on("end", function() {});

  var start = microtime.now();

  var readStream = fs.createReadStream(citygmlPath);
  readStream.pipe(saxParser);
};

module.exports = citygmlToObj;
