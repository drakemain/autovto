const https = require('https');
const queryString = require('querystring');
const cheerio = require('cheerio');
const readline = require('readline');

let RequestContextKey = '';
let login = '';
let obfuscatedPhoneNumber = '';
let codeReceipt = '';
let authenticationKey = '';
let auth = {
  'amzn-idp-auth-key': '',
  'amzn-idp-auth-token': '',
  'amzn-idp-td-key': '',
  'amzn-idp-td-token': '',
  'JSESSIONID': ''
};

let getRequest = (requestURL, shouldReturnBody = false) => {
  return new Promise((res, rej) => {
    let result = {
      responseBody: '',
      headers: {},
      url: requestURL
    };
    
    https.get(requestURL, response => {
      console.log(`GET Request: ${requestURL}`);
      console.log(`Status: ${response.statusCode}`);
      
      if (response.statusCode !== 302 && response.statusCode !== 200) {
        rej(new Error('Bad response.'));
      }

      result.headers = response.headers;
      
      if (!shouldReturnBody) { res(result); return;}
      else { console.log('Fetching response body..'); }

      response.on('data', chunk => {
        result.responseBody += chunk;
        console.log(` --Chunk: ${chunk.length}`);
      });

      response.on('end', () => {
        console.log(' ----Complete.');
        res(result);
      });

      response.on('error', err => {
        rej(err);
      });
    });
  });
};

let postRequest = (options, urlEncodedData, shouldReturnBody) => {
  return new Promise((res, rej) => {
    let result = {
      responseBody: '',
      headers: {}
    };

    let postRequest = https.request(options, response => {
      console.log(`POST Request: ${options.hostname}${options.path}`);
      console.log(`Status: ${response.statusCode}`);

      if (response.statusCode !== 302 && response.statusCode !== 200) {
        rej(new Error('Bad response.'));
      }

      result.headers = response.headers;

      if (!shouldReturnBody) { res(result); return;}
      else { console.log('Fetching response body..'); }
      
      response.on('data', chunk => {
        result.responseBody += chunk;
      });

      response.on('end', () => {
        res(result);
      });

      response.on('error', err => {
        rej(err);
      });
    });

    postRequest.write(urlEncodedData);
    postRequest.end();
  });
};

let getSAMLRedirect = () => {
  const url = 'https://hub.amazon.work/login';

  console.log(`GET request at ${url}.`);

  return getRequest(url).then(response => {
    return response.headers.location;
  });
};

let getRequestContextKey = (SAMLUrl) => {
  console.log('\n');
  return getRequest(SAMLUrl, true).then(response => {
    let $ = cheerio.load(response.responseBody);
    RequestContextKey = $('input[name="RequestContextKey"]').attr().value;

    console.log(`Retrieved RequestContextKey: ${RequestContextKey}.`);
  });
};

let inputUserName = () => {
  console.log('\n');
  return new Promise((res) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
  
    rl.question('Enter username: ', username => {
      rl.close();
      login = username;
      res(username);
    });
  });
};

let submitUsername = (username) => {
  console.log('\n');
  console.log(`Attempting to POST login id: ${login}.`);

  const data = queryString.stringify({
    login: username,
    RequestContextKey: RequestContextKey,
    AuthenticationStep: 'ENTER_USERNAME'
  });

  let options = {
    hostname: 'idp.amazon.work',
    path: '/idp/login',
    method: 'POST',
    headers: {
      'Content-Length': data.length,
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  };

  return postRequest(options, data, true);
};

let selectPhone = phoneSelectForm => {
  console.log('\n');
  let $ = cheerio.load(phoneSelectForm.responseBody);
  let obfuscatedPhoneNumbers = $('#phoneNumberSelectionIndex').children('option').toArray();

  if (obfuscatedPhoneNumbers.length > 2) {
    let phoneNumbers = {};

    for (let i = 1; i < obfuscatedPhoneNumbers.length; ++i) {
      phoneNumbers[obfuscatedPhoneNumbers[i].attribs.value] = obfuscatedPhoneNumbers[i].children[0].data;
    }

    // TODO: Prompt for device selection
  } else {
    obfuscatedPhoneNumber = obfuscatedPhoneNumbers[1].children[0].data;
    console.log(`Selected ${obfuscatedPhoneNumber} to receive verification code.`);
    return Promise.resolve(0);
  }
};

let requestVerificationCode = phoneNumberSelectionIndex => {
  console.log('\n');
  const data = queryString.stringify({
    login: 'drakmain',
    RequestContextKey: RequestContextKey,
    AuthenticationStep: 'SELECT_PHONE',
    phoneNumberSelectionIndex: phoneNumberSelectionIndex
  });

  let options = {
    hostname: 'idp.amazon.work',
    path: '/idp/login',
    method: 'POST',
    headers: {
      'Content-Length': data.length,
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  };

  return postRequest(options, data, true).then(codeInputForm => {
    console.log('\n');
    console.log(`A verification code has been sent to ${obfuscatedPhoneNumber}.`);
    let $ = cheerio.load(codeInputForm.responseBody);
    codeReceipt = $('#dropDownForm').children('input[name="codeReceipt"]').attr().value;
    console.log(`Code Receipt: ${codeReceipt}`);
  });
};

let inputVerificationCode = () => {
  console.log('\n');
  return new Promise((res) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
  
    rl.question('Enter the verification code: ', code => {
      rl.close();
      res(code);
    });
  });  
};

let submitVerificationCode = (code) => {
  console.log('\n');
  console.log(`Attempting to POST code: ${code}.`);

  const data = queryString.stringify({
    login: 'drakmain',
    RequestContextKey: RequestContextKey,
    AuthenticationStep: 'ENTER_OTP',
    phoneNumberSelectionIndex: 0,
    code: code,
    trustedDevice: 1,
    obfuscatedPhoneNumber: obfuscatedPhoneNumber,
    codeReceipt: codeReceipt
  });

  let options = {
    hostname: 'idp.amazon.work',
    path: '/idp/login',
    method: 'POST',
    headers: {
      'Content-Length': data.length,
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  };

  return postRequest(options, data, true).then(pwForm => {
    let $ = cheerio.load(pwForm.responseBody);
    authenticationKey = $('input[name="authenticationKey"]').attr().value;

    const authValues = pwForm.headers['set-cookie'];

    auth['amzn-idp-auth-key'] = authValues[3];
    auth['amzn-idp-auth-token'] = authValues[4];
    auth['amzn-idp-td-key'] = authValues[5];
    auth['amzn-idp-td-token'] = authValues[6];

    for (let key in auth) {
      auth[key] = auth[key].split(';')[0].split('=')[1];
      console.log(`Fetched authentication token: ${key}.`);
    }
  });
};

let inputPassword = () => {
  console.log('\n');
  return new Promise((res) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
  
    rl.question('Enter your password: ', password => {
      rl.close();
      res(password);
    });
  });  
};

let submitPassword = (password) => {
  console.log('\n');
  const data = queryString.stringify({
    login: 'drakmain',
    RequestContextKey: RequestContextKey,
    AuthenticationStep: 'ENTER_PASSWORD',
    authenticationKey: authenticationKey,
    password: password
  });

  let options = {
    hostname: 'idp.amazon.work',
    path: '/idp/login?sif_profile=amazon-passport',
    method: 'POST',
    headers: {
      'Content-Length': data.length,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': buildAuthCookieString()
    }
  };

  return postRequest(options, data).then(pwSubmission => {
    auth['JSESSIONID'] = pwSubmission.headers['set-cookie'][0].split(';')[0].split('=')[1];
    console.log('Got JSESSIONID.');
  });
};

let buildAuthCookieString = () => {
  let authKeyString = '';
  for (let key in auth) {
    authKeyString += `${key}=${auth[key]}; `;
  }

  return authKeyString;
};
module.exports.buildAuthCookieString = buildAuthCookieString;

module.exports.getAuthKeys = getSAMLRedirect()
  .then(getRequestContextKey)
  .then(inputUserName)
  .then(submitUsername)
  .then(selectPhone)
  .then(requestVerificationCode)
  .then(inputVerificationCode)
  .then(submitVerificationCode)
  .then(inputPassword)
  .then(submitPassword)
  .then(() => {
    console.log('\nAuthentication complete.\n');
    return auth;
  })
  .catch(console.error);