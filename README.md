# CityGML to OBJ

Takes a CityGML file and creates an OBJ file for each building

## Usage

```javascript
var citygml2obj = require("citygml-to-obj");
citygml2obj("/path/to/some.gml", "/path/for/obj/output/", function() {
  console.log("Finished converting CityGML file");
});
```

## Example output

```
# Origin: (393408.81326613, 35.3899993896484, 5820431.70758075)
# SRS: EPSG:25833
# Generated using the polygons-to-obj package

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
