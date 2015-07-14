var _ = require("lodash");
var async = require("async");
var fs = require("fs-extra");
var path = require("path");
var UUID = require("uuid");
var microtime = require("microtime");
var DOMParser = require("xmldom").DOMParser;
var proj4 = require("proj4");
var request = require("request");

// CityGML helpers
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

  processBuilding(msg, function(err) {
    var end = microtime.now();

    process.send({
      finished: true,
      err: (err) ? err.message : undefined,
      pid: process.pid,
      time: ((end - start) / 1000)
    });
  });
});

var processBuilding = function(data, pCallback) {
  var proj4def = data.proj4def;
  var bingKey = data.bingKey;
  var overwrite = (data.overwrite === true) ? true : false;

  var zUP = true;

  var xmlDOM = domParser.parseFromString(data.xml);

  var id = xmlDOM.firstChild.getAttribute("gml:id") || UUID.v4();
  var outputPath = path.join(data.objPath, id + ".obj");

  // Skip building if it already exists and overwriting is disabled
  // TODO: Probably a good idea to make this async
  if (!overwrite && fs.openSync(outputPath, "r")) {
    pCallback(new Error("Building has already been converted: " + outputPath));
    return;
  }

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

        // REMOVED: Superfluous to needs right now as collinear checks are
        // performed in the validation step.
        //
        // // Compare face normals with polygon
        // var f1 = faces[0];
        //
        // var fp0 = $V(polygon[f1[0]]);
        // var fp1 = $V(polygon[f1[1]]);
        // var fp2 = $V(polygon[f1[2]]);
        //
        // var fNormal = normalUnit(fp0, fp1, fp2);
        //
        // var p0, p1, p2;
        // var pNormal;
        // var collinearThreshold = 0.01;
        //
        // // Find first sequence of points that aren't collinear
        // _.each(polygon, function(point, pIndex) {
        //   // Exit if no more points are available
        //   if (pIndex === polygon.length - 2) {
        //     return false;
        //   }
        //
        //   p0 = $V(point);
        //   p1 = $V(polygon[pIndex+1]);
        //   p2 = $V(polygon[pIndex+2]);
        //
        //   // Colinear or near-colinear?
        //   var cross = p0.subtract(p1).cross(p0.subtract(p2));
        //
        //   // Exit if non-collinear points are found
        //   if (Math.abs(cross.e(1)) > collinearThreshold || Math.abs(cross.e(2)) > collinearThreshold || Math.abs(cross.e(3)) > collinearThreshold) {
        //     pNormal = normalUnit(p0, p1, p2);
        //     return false;
        //   }
        // });

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
    // Find origin point

    // Vertical can be either Y (1) or Z (2)
    var verticalIndex = (zUP) ? 2 : 1;

    // Horizontal can be either X (0) or Y (1)
    var horizontalIndex = (zUP) ? 0 : 1;

    var origin;
    var vertMin;

    _.each(polygons, function(polygon) {
      // Find minimum on vertical axis
      _.each(polygon, function(point) {
        if (!vertMin) {
          vertMin = point[verticalIndex];
          return;
        }

        if (point[verticalIndex] < vertMin) {
          vertMin = point[verticalIndex];
          return;
        }
      });
    });

    // Collect points that share minimum vertical values
    var vertMinPoints = [];
    _.each(polygons, function(polygon) {
      _.each(polygon, function(point) {
        vertMinPoints = _.unique(vertMinPoints.concat(_.filter(polygon, function(point) {
          return (point[verticalIndex] === vertMin);
        })));
      });
    });

    // Find point with minimum on alternate horizontal axis
    _.each(vertMinPoints, function(point) {
      if (!origin) {
        origin = _.clone(point);
        return;
      }

      if (point[horizontalIndex] < origin[horizontalIndex]) {
        origin = _.clone(point);
        return;
      }
    });

    callback(null, polygons, faces, origin);
  }, function(polygons, faces, origin, callback) {
    var projection = proj4.defs("EPSG:ORIGIN", proj4def);

    // Convert coordinates from SRS to WGS84 [lon, lat]
    var coords = proj4("EPSG:ORIGIN").inverse([origin[0], origin[1]]);

    var url = "http://dev.virtualearth.net/REST/v1/Elevation/List?points=" + coords[1] + "," + coords[0] + "&heights=sealevel&key=" + bingKey;

    // Retreive elevation via Bing API
    request(url, function(err, res, body) {
      if (err) {
        callback(new Error("Unable to retrieve elevation data"));
        return;
      }

      var bodyJSON = JSON.parse(body);

      if (!bodyJSON.resourceSets[0].resources || bodyJSON.resourceSets[0].resources.length === 0) {
        callback(new Error("Unexpected elevation API response"));
        return;
      }

      if (!bodyJSON.resourceSets[0].resources[0].elevations || bodyJSON.resourceSets[0].resources[0].elevations.length === 0) {
        callback(new Error("Elevation values not present in API response"));
        return;
      }

      var elevations = bodyJSON.resourceSets[0].resources[0].elevations;
      var zoomLevel = bodyJSON.resourceSets[0].resources[0].zoomLevel;

      callback(null, polygons, faces, origin, elevations[0]);
    });
  }, function(polygons, faces, origin, elevation, callback) {
    // Create OBJ using polygons and faces
    var objStr = polygons2obj(polygons, faces, origin, elevation, true);

    // Add SRS to the OBJ header
    // var srsStr = "# SRS: " + srs.name + "\n";
    //
    // objStr = srsStr + objStr;

    callback(null, objStr);
  }, function(objStr, callback) {
    // Save OBJ file
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
      pCallback(err);
    }
  });
};

// var normalUnit = function(p1, p2, p3) {
//   var v1 = $V(p1);
//   var v2 = $V(p2);
//   var v3 = $V(p3);
//
//   var a = v2.subtract(v1);
//   var b = v3.subtract(v1);
//
//   return a.cross(b).toUnitVector();
// };

var saveFile = function(output, callback) {
  fs.outputFile(output.path, output.data, function(err) {
    callback(err);
  });
};
