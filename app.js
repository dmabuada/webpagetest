"use strict";

var fs = require('fs');
var mongoClient = require('mongodb').MongoClient;
var key = require("./key");
var WebPageTest = require('webpagetest');
var wpt = new WebPageTest('www.webpagetest.org', key.appKey);

var testDate = new Date();
console.log('--------------------------------------------');
console.log(
  'Webpagetest initiated at ' +
  testDate.getHours() + ':' +
  (testDate.getMinutes()<10?'0':'') + testDate.getMinutes() +
  ' on ' + testDate.getFullYear() + '-' +
  (testDate.getMonth()<9?'0':'') + (testDate.getMonth()+1) + '-' +
  (testDate.getDate()<10?'0':'') + testDate.getDate()
);

/*
 * Array of pages to test
 * Should be a good cross-section of each unique page type
 * Limited to 200 requests/day by our public key
 */

var testPages = [
  // Science of Us
  {
    'brand': 'Science of Us',
    'type': 'homepage',
    'url': 'http://nymag.com/scienceofus/'
  }

];

/**
 * @param {number} unixTimestamp
 * @return {string} iso date
 */
function convertToIso(unixTimestamp) {
  var newDate = new Date(unixTimestamp * 1000);
  var isoDate = newDate.toISOString();
  return isoDate;
}

mongoClient.connect('mongodb://localhost:27017/test', {}, function(err,db) {
  if (err) throw err;
  console.log('Connected to mongoDB!');

  var progress = {
    'totalPages': testPages.length,
    'totalSuccess': 0,
    'totalFail': 0,
    'start' : function() {
      requestFromWebpagetest();
      //createGraphs();
    },
    'moveOn': function(error) {
      if ( ! error) {
        this.totalSuccess += 1;
      } else {
        this.totalFail += 1;
        console.log(error.toString());
      }
      if (this.totalPages === (this.totalSuccess + this.totalFail)) {
        // go to next step
        createGraphs();
      }
    },
    'done': function() {
      console.log('Total pages tested: ' + this.totalSuccess + '. Total pages not tested: ' + this.totalFail + '.');
      //db.close();
    }
  };

  function requestFromWebpagetest() {
    testPages.forEach(function(testPage, i, a){
      wpt.runTest(testPage.url, function(err, data) {
        if (err) {
          progress.moveOn(err);
        } else {
          console.log('Request submitted: ' + testPage.url);
          var testId = data.data.testId;
          var totalWaitMinutes = 0;
          checkForResults();
        }
        function checkForResults() {
          wpt.getTestResults(testId, function(err, data) {
            console.log('whats our data', data);
            if (err) {
              progress.moveOn(err);
            } else {
              var minutesToWait = 1;
              switch (Math.floor(data.statusCode/100)) {
                case 1:
                  console.log('In progress: ' + testPage.url + '. Trying again in ' + minutesToWait + ' minutes.');
                  totalWaitMinutes += minutesToWait;
                  if (totalWaitMinutes > minutesToWait*15) {
                    progress.moveOn('Abort: ' + testPage.url + '. Waited ' + (minutesToWait*15) + ' minutes.');
                  } else {
                    setTimeout(checkForResults,minutesToWait*60*1000);
                  }
                  break;
                case 2:
                  console.log('Success: results received: ' + testPage.url);
                  // add page information to results object
                  data.page = testPage;
                  console.log('case 2', data);
                  // convert to iso date
                  data.data.completed = convertToIso(data.data.completed);
                  db.collection('results').insert(data, function(err, inserted) {
                    if (err) console.log(err.message);
                    console.dir('Success: saved to database: ' + testPage.url);
                    progress.moveOn();
                  });
                  break;
                default:
                  progress.moveOn('Error: ' + data.statusCode + ' ' + data.statusText);
                  break;
              }
            }
          });
        }
      });
    });
  }

  function createGraphs() {

    /* Query mongodb for:

     response.data.completed == date of test
     response.data.testUrl == test url

     response.data.run.firstView.results.
         "URL" : "http://nymag.com",
         "domTime" : 0,
         * "TTFB" : 168, (time from http request to receiving first byte)
         ? "render" : 192, ??? page stops being blank?
         "renderDT" : 194, ???
         * "firstPaint" : 207,
         * "titleTime" : 282,
         * "domContentLoadedEventStart" : 1896, = $(document).ready()
         * "domContentLoadedEventEnd" : 1981,
         "docTime" : 4456,
         "loadTime" : 4456,
         * "loadEventStart" : 4471,
         "loadEventEnd" : 4472,
         * "fullyLoaded" : 5708,
         "lastVisualChange" : 7695,
         * "VisuallyCompleteDT" : 7695,
         "visualComplete" : 7695,

     Add later:
     response.data.run.repeatView.results.

    */


/*    **Page loading events -v2**
    - First Byte = "TTFB" - The time until the first byte of the base page is returned (after following any redirects)
    - "titleTime" - title displays in the browser
    - Start Render = "firstPaint" or "render" - first non-white content was painted to the screen
    - Load Event Start = "loadEventStart" - browser reported time of the start of the load event from the W3C Navigation Timing
    - Document Complete = "loadTime", "docTime" - The time until the onload event was fired (as measured by WebPagetest, not Navigation Timing)
    - Fully Loaded - "fullyLoaded" - The time until network activity finished after the onload event (all assets loaded)

  **Stats**
    - Bytes In (Doc) = "bytesInDoc" - The number of bytes downloaded before the Document Complete time
      - Requests (Doc) = "requestsDoc" - The number of http(s) requests before the Document Complete time

### Data added for each page
    - "page" :
    -- "brand" : "Bedford + Bowery"
    -- "type" : "homepage"
    -- "url" : "http://bedfordandbowery.com/"

    */


    console.log('Query MongoDB.');
    db.collection('results').aggregate([
      {
        $project : {
          _id : 0,
          pageBrand: '$page.brand',
          pageType: '$page.type',
          pageUrl: '$page.url',
          date: '$response.data.completed',
          url: '$response.data.testUrl', //now redundant
          firstByte: '$response.data.run.firstView.results.TTFB', //1
          titleLoad: '$response.data.run.firstView.results.titleTime', //2
          firstPaint: '$response.data.run.firstView.results.firstPaint', //3
          loadEventStart: '$response.data.run.firstView.results.loadEventStart', //4
          docComplete: '$response.data.run.firstView.results.docTime', //5
          fullyLoaded: '$response.data.run.firstView.results.fullyLoaded', //6
          visuallyComplete: '$response.data.run.firstView.results.VisuallyCompleteDT', //7 optional
          // stats
          bytesInDoc : '$response.data.run.firstView.results.bytesInDoc',
          requestsDoc : '$response.data.run.firstView.results.requestsDoc'
        }
      },
      {
        $sort: {
          url: 1,
          date: 1
        }
      }
    ],function(err, results) {
      if (err) throw err;
      db.close();

      // Create graphs from data
      console.log('Creating useful graphs from mongodb data.');
      // Format HTML
      /*
      var htmlOutput = '<html><head><title>WebPageTest Results</title></head><body>' +
        '<link href="stylesheets/simple-graph.css" media="all" rel="stylesheet" />' +
        '<script>var JSONData = ' + JSON.stringify(results) + ';</script>' +
        '<script src="javascripts/simple-graph.js"></script>' +
        '</body></html>';
      */
      var htmlOutput = '<html><head><title>WebPageTest Results</title></head><body>' +
        '<link href="stylesheets/simple-graph.css" media="all" rel="stylesheet" />' +
        '<script>var JSONData = ' + JSON.stringify(results) + ';</script>' +
        '<script src="javascripts/simple-chart.js"></script>' +
        '</body></html>';

      // Save to file
      var resultsFile = __dirname + '/public/results.html';
      fs.writeFile(resultsFile , htmlOutput, function(err) {
        if(err) {
          console.log(err);
        } else {
          console.log('Results saved to ' + resultsFile + '!');
        }
      });


    });

    /*
    console.log('Creating useful graphs from mongodb data.');
    console.log('Generate graphs (using package?).');
    console.log('Save html graph file or image?.');
    console.log('Send email if necessary.');
    console.log('Close database connection and quit the app.');
    progress.done();

    */
  }


  // Start the process
  progress.start();

});
