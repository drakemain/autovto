const login = require('./authenticate').CLI;
const reauthenticate = require('./authenticate').reauthenticate;
const buildCookieString = require('./authenticate').buildCookieString;
const https = require('https');
const queryStringify = require('querystring').stringify;

let user;
let pw;
let csrfToken;
let cookieString;
let cookies;
const startTime = new Date();
let timeToRun = 0;
const employeeID = '101146319';
const checkInterval = {
  min: 10,
  rand: 20
};

let parseCLIParams = () => {
  for (let i = 0; i < process.argv.length; i += 2) {
    let param = process.argv[i];
    let value = process.argv[i + 1];
    switch(param) {
    case 'mininterval':
      if (!isNaN(value)) {checkInterval.min = Number(value);}
      else {console.log('\x1b[31m', `\nInvalid ${param} (${value})! Using default: ${checkInterval.min}`, '\x1b[0m');}
      break;

    case 'randinterval':
      if (!isNaN(value)) {checkInterval.rand = Number(value);}
      else {console.log('\x1b[31m', `\nInvalid ${param} (${value})! Using default: ${checkInterval.rand}`, '\x1b[0m');}
      break;

    case 'duration':
      if (!isNaN(value)) {timeToRun = Number(value);}
      else {console.log('\x1b[31m', `\nInvalid ${param} (${value})! Using default: ${timeToRun}`, '\x1b[0m');}
      break;
    }
  }

  console.log(`Minimum interval: ${checkInterval.min}s | Random modifier: ${checkInterval.rand}s | Run duration: ${timeToRun}s`);
};

let stats = {
  acceptedVto: 0,
  missedVTO: 0,
  checks: 0,
  authRefresh: 0,
  ECONNRESET: 0,

  getStatsString() {
    return `Successfully Accepted: ${this.acceptedVto}`
    + ` | Missed Opportunities: ${this.missedVTO}` 
    + ` | Total Checks: ${this.checks}`
    + ` | Total Authentication: ${this.authRefresh}`
    + ` | ECONNRESET ${this.ECONNRESET}`;
  }
};

(() => {
  parseCLIParams();

  login().then(authHeaders => {
    loadAuthData(authHeaders);
    
    return run();
    
  }).then(() => {
    console.log('Final stats:\n', '\x1b[1m', stats.getStatsString(), '\x1b[0m');
  }).catch(err => {
    console.log('Unhandled error!');
    console.error(err);
  });
})();

let run = () => {
  return new Promise((res) => {
    (function loop() {
      let now = new Date();
      let runTime = Math.round((now - startTime) / 1000);
      const interval = (checkInterval.min + (Math.random() * checkInterval.rand)) * 1000;

      console.log('\n\x1b[40m', new Date().toLocaleTimeString(), '\x1b[0m');
      console.log(`Seconds since start: ${Math.round(runTime)}.`);

      return fetchOpportunities()
        .then(findActiveOpportunity)
        .then(claimOpportunity)
        .then(() => {
          res();
        })
        .catch(err => {
          console.log(err.message);
          console.log('\n\x1b[1m', stats.getStatsString(), '\x1b[0m', '\n');

          if (checkRuntimeExceeded(runTime)) {
            res();
            return;
          }
          
          if (err.code === 'ENOTFOUND' || err.code === 'ETIMEDOUT') {
            console.log(`Connection Failure! Trying again in ${Math.floor(interval / 1000)}s.`);
            console.log();
            setTimeout(loop, interval);
          } else if (err.code === 'ECONNRESET') {
            // This is untested and can therefore potentially not actually work.
            ++stats.ECONNRESET;
            console.log('Connection Reset! Trying again in 1 minute.');
            setTimeout(loop, 60000);
          } else if (err.code === 'NOVTO' || err.code === 'VTOCLAIM') {
            console.log(`Trying again in ${Math.floor(interval / 1000)}s.`);
            setTimeout(loop, interval);
          } else {
            console.log('Authentication expired.');
            return reauthenticate(user, pw).then(loadAuthData).then(loop);
          }
        });
    })();
  });
};

let fetchOpportunities = () => {
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
        console.log('Error on GET');
        console.error(err);
        rej(err);
      });
    }).on('error', err => {
      console.log('Could not GET');
      rej(err);
    });
  });
};

let findActiveOpportunity = (opportunities) => {
  console.log('Examining opportunities..');
  let activeOpportunity = null;

  if (!opportunities) { return null; }

  let vtoArr = opportunities.vtoOpportunities;
  let opportunityLog;

  if (vtoArr) {
    for (let i = 0; i < vtoArr.length; ++i) {
      opportunityLog = ` --${i + 1}) ${vtoArr[i]['opportunity_id']}: ${vtoArr[i].workgroup} | ${vtoArr[i].start_time} → ${vtoArr[i].end_time}`;
      
      if (vtoArr[i].active) {
        console.log(opportunityLog, '\x1b[32m', '✓', '\x1b[0m');
        activeOpportunity = vtoArr[i];
        break;
      } else {
        console.log(opportunityLog,'\x1b[31m', '✘', '\x1b[0m');
      }
    }
  }

  return activeOpportunity;
};

let claimOpportunity = (opportunity) => {
  if (opportunity === null) {
    let err = new Error('No opportunity to claim.');
    err.code = 'NOVTO';
    return Promise.reject(err);
  }

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

      console.log(`Status ${response.statusCode}: ${response.statusMessage}`);

      response.on('data', chunk => {
        body += chunk;
      });

      response.on('end', () => {
        try {
          res(JSON.parse(body));
        } catch(err) {
          res({});
        }
      });

      response.on('error', err => {
        console.log('An error occured while fetching VTO POST claim response.');
        rej(err);
      });
    });

    postRequest.write(data);
    postRequest.end();
  }).then(response => {
    if (response['errors']) {
      ++stats.missedVTO;
      let err = new Error(`Failed to claim VTO: ${response['errors']}`);
      err.code = 'VTOCLAIM';
      throw err;
    } else {
      ++stats.acceptedVto;
      console.log('Success!');
    }
  });
};

let checkRuntimeExceeded = (runTime) => {
  if (timeToRun !== 0) {
    if (runTime > timeToRun) {
      return true;
    }
  }

  return false;
};

let loadAuthData = (authData) => {
  ++stats.authRefresh;
  cookies = authData.cookies;
  cookieString = buildCookieString(authData.cookies);
  csrfToken = authData['X-CSRF-TOKEN'];
  user = authData.user;
  pw = authData.pw;
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