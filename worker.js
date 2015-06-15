var _ = require("lodash");
var async = require("async");
var fs = require("fs-extra");
var path = require("path");
var UUID = require("uuid");
var microtime = require("microtime");
var DOMParser = require("xmldom").DOMParser;

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

// Receive messages from the master process
process.on("message", function(msg) {
  if (!msg.xml || !msg.objPath) {
    process.exit();
  }

  var start = microtime.now();

  processBuilding(msg, function() {
    var end = microtime.now();

    process.send({
      finished: true,
      pid: process.pid,
      time: ((end - start) / 1000)
    });
  });
});

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
      // TODO: Halt conversion on particularly bad validation errors
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

    // Coordinates of origin (0,0,0) of the OBJ
    var originPoint = polygons[0][0];

    // Add origin and SRS to the OBJ header
    var originStr = "# Origin: (" + originPoint[0] + ", " + originPoint[1] + ", " + originPoint[2] + ")\n";

    var srsStr = "# SRS: " + srs.name + "\n";

    objStr = originStr + srsStr + objStr;

    callback(null, objStr);
  }, function(objStr, callback) {
    // Save OBJ file
    var outputPath = path.join(data.objPath, id + ".obj");

    saveFile({
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
