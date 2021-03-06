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

function isNumeric(n) {
	return !isNaN(parseFloat(n)) && isFinite(n);
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

function uiStr(x) {
	return defVal(x, '');
}

function boolStr(b, d = 'N/A') {
	if(isEmpty(b)) {
		return d;
	} else {
		return b ? 'Yes' : 'No';
	}
}

const siPostfixes = [
	// Descending order
	{ postfix: 'M', multiplier: 1000000 },
	{ postfix: 'k', multiplier: 1000 }
]
function siPostfix(n, decimalPlaces = 1) {
	for(const def of siPostfixes) {
		if(n / def.multiplier > 1) {
			return (n / def.multiplier).toFixed(decimalPlaces) + def.postfix;
		}
	}

	return numStr(n);
}

function numStr(n, decimalPlaces = 2) {
	if(typeof n === 'number') {
		return n.toFixed(decimalPlaces);
	} else {
		return '-';
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
const urlCountryBordersGeoJSON = 'data/countries.geojson'; // Local at data/countries.geojson or live at https://datahub.io/core/geo-countries/r/countries.geojson
const urlUKInfo = 'data/uk-info.json';
const urlGeneralCountryInfo = 'https://restcountries.eu/rest/v2/all';

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
const countryData = {};

// Central data handling

function addCountryData(countryCode, data) {
	if(countryCode) {
		if (!countryData.hasOwnProperty(countryCode)) {
			countryData[countryCode] = {};
		}

		Object.assign(countryData[countryCode], data);
	}
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

		// FCO exemption lists do not match up (as expected)
		// e.g. Country							FCO Advice 		England Quarantine
		// 		Finland (and most of europe)	Exempt			No
		// 		Estonia, Latvia					Exempt			Yes
		// checked against online lists
	}
}

// Load data

const oxcgrtURL = 'https://raw.githubusercontent.com/OxCGRT/covid-policy-tracker/master/data/OxCGRT_latest.csv'; // Local copy at data/OxCGRT_latest.csv
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
		
const promiseGeneralCountryInfoLoaded = 
	fetch(urlGeneralCountryInfo)
		.then(response => response.json())
		.then(data => processGeneralCountryInfo(data));

// Data processing

function processUKInfo(data) {

    // Relies on destination policies being loaded
    promiseDestinationRestrictionsLoaded.then(function() {
        console.log('Processing UK info data:', data);

        console.group();

		// Translate to by-country structure
		for(const ruleName in data.rules) {
			const rule = data.rules[ruleName];

			for(const exemptEntry of rule.exemptCountries) {

				const countryName = exemptEntry.name;

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

					// Save notes seperatley
					if(exemptEntry.note) {
						o[ruleName + 'Note'] = exemptEntry.note;
					}

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
				if(curCountryInfo.ConfirmedDeaths && curCountryInfo.ConfirmedCases) {
					curCountryInfo.calculatedCFR = curCountryInfo.ConfirmedDeaths / curCountryInfo.ConfirmedCases * 100;
				}

                addCountryData(curCountryCode, curCountryInfo);
                // byCountryData[curCountryCode] = curCountryInfo;
            }

            // Reset country block variables
            curCountryInfo = undefined;
            curCountryCode = dataRow.CountryCode;
        }

        if (true) { // Assume true
            // Some fields still haven't been populated with a latest value

			// Initialise
			if(!curCountryInfo) {
				curCountryInfo = {};
			}

			// Integrate data
			// cant use Object.assign() because it overwrites (maybe could use it in reverse and then
			// save dataRow via addCountryData, but this is cleaner
			for(const propName in dataRow) {
				// Add data only where the property does not exist and the new value is not empty
				if(!curCountryInfo.hasOwnProperty(propName) && !isEmpty(dataRow[propName])) {
					curCountryInfo[propName] = dataRow[propName];
				}
			}

			// Save all properties in one go approach
            // if (dataRow.hasOwnProperty(targetCSVField) && dataRow[targetCSVField].length > 0) {
            //     curCountryInfo = dataRow;
            // }
        }
	}
}

function processGeneralCountryInfo(data) {
	const countries = data;
	console.log('Processing World Bank countries', data);

	for(const country of countries) {
		const key = country.alpha3Code;
		addCountryData(key, { generalInfo: country });
	}
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
		let output = {};

        if(props) {
			const cd = getCountryInfo(props.ISO_A3, props.ADMIN);

			if(cd) {
				const tp = cd.internationalTravelPolicy || {};
	
				// TODO: Show X, tick or ?/~ next to issues

				this._div.innerHTML = `<h4>${cd.CountryName}</h4>
				<b>Map Country</b> ${props.ADMIN} (${props.ISO_A3})<br>
				<b>Travel Policy</b> ${tp.text || '-'} (${tp.value})<br>
				<b>FCO Exempt</b> ${cd.fcoAllowsTravel ? 'Yes' : 'No'} ${uiStr(cd.internationalTravelNote)}<br>
				<b>Quarantine on return to England</b> ${boolStr(cd.quarntineOnReturnToEngland, 'Yes')} ${uiStr(cd.quarntineOnReturnToEnglandNote)}<br>
				<b>By Population</b> (${siPostfix(cd.generalInfo.population)}) ${siPostfix(cd.casesPerMillion)} cases and ${siPostfix(cd.deathsPerMillion)} deaths per million<br>
				<b>CFR</b> ${numStr(cd.calculatedCFR)}% (${siPostfix(cd.ConfirmedDeaths)} / ${siPostfix(cd.ConfirmedCases)})<br>
				<b>Stringency Index</b> ${cd.StringencyIndexForDisplay}`;
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

function openFCOAdvicePage(e) {
	const name = e.target.feature.properties.ADMIN;

	window.open('https://www.gov.uk/foreign-travel-advice/' + name.toLowerCase(), '_blank');
}

function onEachFeature(feature, layer) {
    layer.on({
        mouseover: highlightFeature,
        mouseout: resetHighlight,
        click: openFCOAdvicePage
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

Promise.all([promiseDOMStart, promiseDestinationRestrictionsLoaded, promiseUKInfoLoaded, promiseGeneralCountryInfoLoaded])
    .then(function() {
		console.log('Finished processing country data', countryData);

        // Apply country borders
        fetch(urlCountryBordersGeoJSON)
            .then(response => response.json())
			.then(function(data) {
				geoJSON = L.geoJson(data, {
					pane: 'overlay',
					style: styleCountryOverlay,
					onEachFeature: onEachFeature 
				}).addTo(map)
			});

		// Compute fields based on multiple datasets
		for(const key in countryData) {
			const cd = countryData[key];

			if(cd.generalInfo && cd.ConfirmedDeaths && cd.ConfirmedCases) {
				cd.casesPerMillion = cd.ConfirmedCases / cd.generalInfo.population * 1E6;
				cd.deathsPerMillion = cd.ConfirmedDeaths / cd.generalInfo.population * 1E6;
			}
		}

		runDataChecks();
    });