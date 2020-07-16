const mapboxAccessToken = 'pk.eyJ1Ijoiai10aG9ybnRvbiIsImEiOiJjazRpYXQ2NWQxNGs0M2txd2sxdXhtbHI5In0.66bQ1BPaIfe4DMPymFdATA';

// Utility functions

function logAndReturn(o) {
    console.log(o);
    return o;
}

function formatDate(d, delimeter = '-') {
    var month = '' + (d.getMonth() + 1),
        day = '' + d.getDate(),
        year = d.getFullYear();

    if (month.length < 2)
        month = '0' + month;
    if (day.length < 2)
        day = '0' + day;

    return [year, month, day].join(delimeter);
}

function square(n) {
    return Math.pow(n, 2);
}

function isEmpty(val) {
    return (val === undefined || val == null || val.length <= 0) ? true : false;
}

function defVal(x, d) {
	if(isEmpty(x)) {
		return d;
	} else {
		return x;
	}
}

function boolStr(b, d = 'N/A') {
	if(isEmpty(b)) {
		return d;
	} else {
		return b ? 'Yes' : 'No';
	}
}

// Utility constants

const now = new Date();
const todayYMD = formatDate(now);
const todayYMDRaw = formatDate(now, '');
console.log('Date:', todayYMD, todayYMDRaw);

//
// 1. Destination policies to travel from source       https://covidtracker.bsg.ox.ac.uk/about-api
// 2. Home quarantine rules on return from destination
// 3. FCO exemption for destination
// 4. Flights available in both directions
//

// https://datahub.io/core/geo-countries
const urlCountryBordersGeoJSON = 'data/countries.geojson'; // Live at https://datahub.io/core/geo-countries/r/countries.geojson
const urlUKInfo = 'data/uk-info.json';

const targetDestinationPoliciesFieldName = 'C8_International travel controls';
const targetDestinationPolicies = {
    // https://github.com/OxCGRT/covid-policy-tracker/blob/master/documentation/codebook.md#containment-and-closure-policies
    '0': 'No restrictions',
    '1': 'Screening arrivals',
    '2': 'Quarantine arrivals from some or all regions',
    '3': 'Ban arrivals from some regions',
    '4': 'Ban on all regions or total border closure'
}

const colorByFCOBlock = true;

// Map variables
var map, mapInfo;
var geoJSON;

// App variables
// [TODO] Integrate into one per-country data structure
const countryData = {};
// var destinationRestrictionsData;
// var ukInfoData;

// Central data handling

function addCountryData(countryCode, data) {
    if (!countryData.hasOwnProperty(countryCode)) {
        countryData[countryCode] = {};
    }

    Object.assign(countryData[countryCode], data);
}

function getCountryInfo(countryCode, countryName) {
	if(countryData.hasOwnProperty(countryCode)) {
		return countryData[countryCode];
	}

	// Fallback to searching by name
	for (const key in countryData) {
		if (countryData[key].CountryName === countryName) {
			return countryData[key]
		}
	}
}

function runDataChecks() {
	console.log('Running data checks');

	for(const countryCode in countryData) {
		const countryInfo = countryData[countryCode];

		// Find any countries which are on one FCO exemption list but not the other
		// if(countryInfo.fcoAllowsTravel == countryInfo.quarntineOnReturnToEngland) {
		// 	console.log(countryInfo);
		// }
	}
}

// Load data

const oxcgrtURL = 'data/OxCGRT_latest.csv';
const promiseDestinationRestrictionsLoaded =
    fetch(oxcgrtURL)
        .then(response => response.text())
        .then(function (csv) {
            const data = Papa.parse(csv, {
                header: true
            }).data;

            processDestinationPolicies(data)
        });

const promiseUKInfoLoaded =
    fetch(urlUKInfo)
        .then(response => response.json())
        .then(data => processUKInfo(data));

// Data processing
// TODO: UK country dataset notes

function processUKInfo(data) {

    // Relies on destination policies being loaded
    promiseDestinationRestrictionsLoaded.then(function() {
        console.log('Processing UK info data:', data);

        console.group();

		// Translate to by-country structure
		for(const ruleName in data.rules) {
			const rule = data.rules[ruleName];

			for(const countryName of rule.exemptCountries) {

				// Find matching Alpha-3 code for country name in secondary data
				let countryCode;
				for (const key in countryData) {
					if (countryData[key].CountryName === countryName) {
						countryCode = key;
						break;
					}
				}

				if (countryCode) {
					let o = {};

					if(ruleName == "internationalTravel") {
						o.fcoAllowsTravel = true;
					} else if(ruleName == "quarantineOnReturnEngland") {
						o.quarntineOnReturnToEngland = false;
					}

					addCountryData(countryCode, o);
				} else {
					console.warn(`Couldn't find country code for ${countryName}`);
				}
			}
		}

        console.groupEnd();
    });

}

function processDestinationPolicies(data) {
	const targetCSVField = targetDestinationPoliciesFieldName;
	
	console.log('Processing destination policies data:', data);

    // Custom filter to find latest entry with C8 info
    // uses date & country ordering of CSV data
    // var byCountryData = {};

    // Loop from end to beginning of CSV data (latest date of each country)
    var curCountryCode;
    var curCountryInfo;
    for (var i = data.length - 1; i >= 0; i--) {
        const dataRow = data[i];

        if (curCountryCode != dataRow.CountryCode) {
            // Found beginning of a new country block

            // Save country info
            if (curCountryInfo) {
                // Integrate extracted properties
                const key = '' + Math.round(curCountryInfo[targetDestinationPoliciesFieldName]);
                curCountryInfo.internationalTravelPolicy = {
                    value: key,
                    text: targetDestinationPolicies[key]
                };

                addCountryData(curCountryCode, curCountryInfo);
                // byCountryData[curCountryCode] = curCountryInfo;
            }

            // Reset country block variables
            curCountryInfo = undefined;
            curCountryCode = dataRow.CountryCode;
        }

        if (!curCountryInfo) {
            // Still searching for latest country info

            if (dataRow.hasOwnProperty(targetCSVField) && dataRow[targetCSVField].length > 0) {
                curCountryInfo = dataRow;
            }
        }
    }

    // destinationRestrictionsData = byCountryData;
}

// Data-based styling

function getCountryColor(countryCode, countryName) {
    const countryInfo = getCountryInfo(countryCode, countryName);

    if (countryCode == 'GBR') {
        return 'rgba(125,125,125,0)';
    }

	const a = 0.7;
    if (countryInfo && countryInfo.hasOwnProperty(targetDestinationPoliciesFieldName)) {
		const fcoBlockEffect = !(countryInfo.fcoAllowsTravel || !colorByFCOBlock);
		const l = fcoBlockEffect ? 15 : 50;
		
		const n = countryInfo[targetDestinationPoliciesFieldName];
		const x = (1 - n / 4);
		return `hsla(${120*x}deg,75%,${l}%,${a})`;
    } else {
        return `rgba(0,0,0,${a})`;
    }
}

function styleCountryOverlay(feature) {
    return {
        fillColor: getCountryColor(feature.properties.ISO_A3, feature.properties.ADMIN),
        weight: 2,
        opacity: 1,
        color: 'white',
        dashArray: '3',
        fillOpacity: 0.7
    };
}

// Map interaction

function setupInfoControl() {
    mapInfo = L.control();

    mapInfo.onAdd = function(map) {
        this._div = L.DomUtil.create('div', 'info'); // create a div with a class "info"
        this.update();
        return this._div;
    };

    // method that we will use to update the control based on feature properties passed
    mapInfo.update = function(props) {
        if(props) {
			const cd = getCountryInfo(props.ISO_A3, props.ADMIN);

			if(cd) {
				const tp = cd.internationalTravelPolicy;
				// console.log('Hovered over', props, cd);
	
				// TODO: Show X, tick or ?/~ next to issues

				this._div.innerHTML = `<h4>${cd.CountryName}</h4>
				<b>Map Country</b> ${props.ADMIN} (${props.ISO_A3})<br>
				<b>Travel Policy</b> ${tp.text} (${tp.value})<br>
				<b>FCO Exempt</b> ${cd.fcoAllowsTravel ? 'Yes' : 'No'}<br>
				<b>Quarantine on return to England</b> ${boolStr(cd.quarntineOnReturnToEngland, 'Yes')}<br>`;
			} else {
				this._div.innerHTML = `<h4>${props.ADMIN} (${props.ISO_A3})</h4>
				No country data found matching country code or name`;
			}
        } else {
            this._div.innerHTML = 'Hover over a country';
        }
    };

    mapInfo.addTo(map);
}

function highlightFeature(e) {
    var layer = e.target;

    layer.setStyle({
        weight: 5,
        //color: '#666',
        dashArray: '',
        fillOpacity: 0.7
    });

    if(!L.Browser.ie && !L.Browser.opera && !L.Browser.edge) {
        layer.bringToFront();
    }

    mapInfo.update(layer.feature.properties);
}

function resetHighlight(e) {
    geoJSON.resetStyle(e.target);
    mapInfo.update();
}

function zoomToFeature(e) {
    map.fitBounds(e.target.getBounds());
}

function onEachFeature(feature, layer) {
    layer.on({
        mouseover: highlightFeature,
        mouseout: resetHighlight,
        click: zoomToFeature
    });
}

// DOM operations
// TODO: Control for colorByFCOBlock
// TODO: Attributions for data sources

const promiseDOMStart =
    document.ready
        .then(function () {

            // Setup choropleth map
			map = L.map('map').setView([0, 0], 3);
			map.createPane('base');
			map.createPane('overlay');
			map.createPane('labels');

			map.getPane('labels').style.zIndex = 650;
			map.getPane('labels').style.pointerEvents = 'none';

            // L.tileLayer('https://api.mapbox.com/styles/v1/{id}/tiles/{z}/{x}/{y}?access_token=' + mapboxAccessToken, {
            //     id: 'mapbox/light-v9',
            //     tileSize: 512,
            //     zoomOffset: -1
			// }).addTo(map);

			let positron = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png', {
				attribution: '©OpenStreetMap, ©CartoDB',
				pane: 'base'
			}).addTo(map);

			let positronLabels = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}.png', {
				attribution: '©OpenStreetMap, ©CartoDB',
				pane: 'labels'
			}).addTo(map);

            // Create controls
            setupInfoControl();

        });

// Data-conditional map operations
// [TODO] Integrate other data-dependant operations above this

Promise.all([promiseDOMStart, promiseDestinationRestrictionsLoaded, promiseUKInfoLoaded])
    .then(function() {
        // Apply country borders
        fetch(urlCountryBordersGeoJSON)
            .then(response => response.json())
			.then(function(data) {
				geoJSON = L.geoJson(data, {
					pane: 'overlay',
					style: styleCountryOverlay,
					onEachFeature: onEachFeature 
				}).addTo(map)
			})
			.then(runDataChecks);
    });