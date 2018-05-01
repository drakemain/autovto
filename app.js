const getAuthKeys = require('./authenticate').getAuthKeys;
const buildCookieString = require('./authenticate').buildCookieString;
// const renewCSRFToken = require('./authenticate').getCSRFToken;
const https = require('https');
const queryStringify = require('querystring').stringify;

let csrfToken;
// let csrfTokenStartTime;
// const csrfTokenLifeTimeSeconds = 0;
let cookieString;
let cookies;
const startTime = new Date();
let timeToRun = 0;
const employeeID = '101146319';
const checkInterval = {
  min: 10,
  rand: 20
};

let stats = {
  acceptedVto: 0,
  missedVTO: 0,
  checks: 0,
  authRefresh: 0,

  getStatsString() {
    return `Successfully Accepted: ${this.acceptedVto}`
    + ` | Missed Opportunities: ${this.missedVTO}` 
    + ` | Total Checks: ${this.checks}`
    + ` | Total Authentication: ${this.authRefresh}`;
  }
};

let main = () => {
  checkInterval.min = Number(process.argv[2]) || checkInterval.min;
  checkInterval.rand = Number(process.argv[3]) || checkInterval.rand;
  timeToRun = Number(process.argv[4]) || timeToRun;

  getAuthKeys().then(authHeaders => {
    ++stats.authRefresh;
    cookies = authHeaders.cookies;
    cookieString = buildCookieString(authHeaders.cookies);
    csrfToken = authHeaders['X-CSRF-TOKEN'];
    
    return VTOWait();
    
  }).catch(err => {
    console.error(err);
    main();
  });
};

let getOpportunities = () => {
  const currentTime = new Date();
  let timeSinceStart = currentTime - startTime;
  timeSinceStart /= 1000;

  console.log(`Seconds since start: ${Math.round(timeSinceStart)}.`);

  return new Promise((res, rej) => {
    console.log('Requesting VTO Opportunities.');

    https.get({
      hostname: 'hub.amazon.work',
      path: '/api/v1/opportunities/get_opportunities?employee_id=' + employeeID,
      headers: {
        Cookie: cookieString
      }
    }, (response) => {
      let body = '';

      setCookie(response.headers['set-cookie']);
  
      response.on('data', chunk => {
        body += chunk;
      });
  
      response.on('end', () => {
        let data;
        try {
          data = JSON.parse(body);
          ++stats.checks;
          res(data);
        } catch(err) {
          rej(err);
        }
        
      });
  
      response.on('error', err => {
        rej(err);
      });
    }).on('error', err => {
      rej(err);
    });
  });
};

let findActiveVTO = (opportunities) => {
  console.log('Examining opportunities..');
  if (!opportunities) { return null; }

  let vtoArr = opportunities.vtoOpportunities;
  let opportunityLog;

  if (vtoArr) {
    for (let i = 0; i < vtoArr.length; ++i) {
      opportunityLog = ` --${i + 1}) ${vtoArr[i]['opportunity_id']}: ${vtoArr[i].workgroup} | ${vtoArr[i].start_time} → ${vtoArr[i].end_time}`;
      
      if (vtoArr[i].active) {
        console.log(opportunityLog, '\x1b[32m', '✓', '\x1b[0m');
        return vtoArr[i];
      } else {
        console.log(opportunityLog,'\x1b[31m', '✘', '\x1b[0m');
      }
    }
  }

  return null;
};

let VTOWait = () => {
  return new Promise((res) => {
    (function loop() {
      const interval = (checkInterval.min + (Math.random() * checkInterval.rand)) * 1000;
      console.log("\x1b[40m", new Date().toLocaleTimeString(), "\x1b[0m");
        
      return getOpportunities()
      .then(findActiveVTO)
      .then(activeVTO => {
        if (activeVTO) {
          console.log('Found a VTO opportunity!');
          res(activeVTO);
        } else {
          console.log('No VTO opportunities apply to you. =(\n');
          let shouldLoop = true;

          if (timeToRun !== 0) {
            let now = new Date();
            let runTime = Math.round((now - startTime) / 1000);
            console.log(`Looping for ${timeToRun - runTime}s.`);

            if (runTime > timeToRun) {
              shouldLoop = false;
            }
          } else {
            console.log('Looping continuously.');
          }

          if (shouldLoop) {
            setTimeout(loop, interval);
          } else {
            console.log('Exceeded runtime. Terminating loop.');
            res(null);
          }
        }

        console.log('\x1b[1m', stats.getStatsString(), '\x1b[0m');
        console.log(`Waiting ${interval}ms until next check.\n`);
      }).catch(err => {
        console.error(err);
        console.log('Authentication expired. Attempting to reauthenticate.');

        main();
      });
    })();
  })
  .then(claimOpportunity);
};

let claimOpportunity = (opportunity) => {
  if (opportunity === null) { return; }

  console.log('Attempting to claim opportunity.');
  let startTime = new Date(opportunity.start_time).getTime() / 1000;
  

  let data = queryStringify({
    opportunity_id: opportunity.opportunity_id,
    start_time: startTime,
    employee_id: employeeID
  });

  let options = {
    hostname: 'hub.amazon.work',
    path: '/api/v1/opportunities/claim',
    method: 'POST',
    headers: {
      'Cookie': cookieString,
      'Content-Length': data.length,
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-CSRF-TOKEN': csrfToken,
    }
  };

  return new Promise((res, rej) => {
    let postRequest = https.request(options, response => {
      let body = '';

      console.log(`Status: ${response.statusCode}`);

      if (response.statusCode !== 400) {
        rej(response.statusMessage);
        return;
      }

      response.on('data', chunk => {
        body += chunk;
      });

      response.on('end', () => {
        res(JSON.parse(body));
      });

      response.on('error', err => {
        rej(err);
      });
    });

    postRequest.write(data);
    postRequest.end();
  }).then(response => {
    if (response['errors']) {
      ++stats.missedVTO;
      console.log(`Failed to claim VTO: ${response['errors']}\n`);
      return VTOWait();
    } else {
      ++stats.acceptedVto;
      console.log(response);
      console.log('This might have worked!... Hopefully.');
    }
  });
};

let setCookie = (cookieArr) => {
  if (!cookieArr) { return; }

  console.log('Updating cookies..');

  for (let i = 0; i < cookieArr.length; ++i) {
    let cookie = cookieArr[i].split(';')[0].split('=');
    cookies[cookie[0]] = cookie[1];
    console.log(` --${cookie[0]}`);
  }

  cookieString = buildCookieString(cookies);
};

main();