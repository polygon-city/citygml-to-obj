# CityGML to OBJ

Takes a CityGML file and creates an OBJ file for each building

## Usage

```javascript
var citygml2obj = require("citygml-to-obj");
citygml2obj("/path/to/some.gml", "/path/for/obj/output/");
```

## Example output

```
# Origin: (392976.932808193, 5820104.07808786, 53.5361781250088)
# SRS: EPSG:25833
# Generated using the polygons-to-obj package

v 0 0 0
v 4.016167488996871 8.072908939793706 0
v 4.015791678975802 8.072353470139205 -17.566176904305706
v -0.0003758090315386653 -0.0005554594099521637 -17.566176904305706
# Etc...

f 5 3 4
f 3 5 2
f 10 8 9
f 8 10 7
# Etc...
```
