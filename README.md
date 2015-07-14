# CityGML to OBJ

Takes a CityGML file and creates an OBJ file for each building

## Usage

```javascript
var citygml2obj = require("citygml-to-obj");

var options = {
  // Path to CityGML input file
  citygmlPath: "/path/to/some.gml",

  // Path to OBJ output directory
  objPath: "/path/for/obj/output/",

  // Used to project CityGML coords to WGS84
  // This projection is an example for the Berlin CityGML dataset
  proj4def: "+proj=utm +zone=33 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs",

  // Used to find ground-height under each building
  bingKey: "your-bing-key",

  // Overwrite existing OBJ files if they already exist
  overwrite: false
};

citygml2obj(options, function(err) {
  if (err) {
    console.error(err);
  }

  console.log("Finished converting CityGML");
});
```

## Example output

```
# Generated using the polygons-to-obj package
# Origin: (393408.81326613, 35.3899993896484, 5820431.70758075)

v 0 0 0
v 0.0007680089911445975 35.8840621565621 -0.0011349096894264221
v -1.3537642270093784 35.8840621565621 1.3126991000026464
v -1.3545322350109927 0 1.3138340096920729
# Etc...

f 5 3 4
f 3 5 2
f 10 8 9
f 8 10 7
# Etc...
```
