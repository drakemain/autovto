const getAuthKeys = require('./authenticate').getAuthKeys;
const postRequest = require('./authenticate').postRequest;
const buildCookieString = require('./authenticate').buildCookieString;
const https = require('https');
const queryStringify = require('querystring').stringify;

let cookies;
let cookieString;
const startTime = new Date();
const employeeID = '101146319';

getAuthKeys().then(cookiesObj => {
  cookies = cookiesObj;
  cookieString = buildCookieString(cookies);
  
  return VTOWait()
    .then(claimOpportunity);
  
}).catch(console.error);

let getOpportunities = () => {
  const currentTime = new Date();
  let timeSinceStart = currentTime - startTime;
  timeSinceStart /= 1000;

  console.log(`Seconds since start: ${Math.round(timeSinceStart)}.`);

  return new Promise((res, rej) => {
    console.log('Requesting VTO Opportunities.');

    https.get({
      hostname: 'hub.amazon.work',
      path: '/api/v1/opportunities/get_opportunities?employee_id=101146319',
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
        res(JSON.parse(body));
      });
  
      response.on('error', err => {
        rej(err);
      });
    });
  });
};

let findActiveVTO = (opportunities) => {
  console.log('Examining opportunities..');
  if (!opportunities) { return null; }

  let vtoArr = opportunities.vtoOpportunities;

  if (vtoArr) {
    for (let i = 0; i < vtoArr.length; ++i) {
      console.log(` --${i + 1}) ${vtoArr[i]['opportunity_id']}`);
      
      if (vtoArr[i].active) {
        return vtoArr[i];
      }
    }
  }

  return null;
};

let VTOWait = () => {
  return new Promise((res) => {
    let loop = () => {
      const interval = (45 + (Math.random() * 15)) * 1000;

      console.log(`Waiting ${interval}ms until next check.`);

      setTimeout(() => {

        getOpportunities()
          .then(findActiveVTO)
          .then(activeVTO => {
            if (activeVTO) {
              console.log('Found a VTO Opportunity!');
              res(activeVTO);
            } else {
              console.log('Did not find a VTO Opportunity. =(\n');
              loop();
            }
          });

      }, interval);
    };

    loop();
  });
};

let claimOpportunity = (opportunity) => {
  console.log('Attempting to claim opportunity.');

  let data = queryStringify({
    opportunity_id: opportunity.opportunity_id,
    start_time: opportunity.start_time,
    employee_id: employeeID
  });

  let options = {
    hostname: 'hub.amazon.work',
    path: '/api/v1/opportunities/claim',
    headers: {
      Cookie: cookieString,
      'Content-Length': data.length,
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  };

  return postRequest(options, data, true).then(response => {
    console.log('Headers: ', response.headers);
    console.log('Body: ', response.responseBody);
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