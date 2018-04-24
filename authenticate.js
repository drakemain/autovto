const https = require('https');
const queryString = require('querystring');
const cheerio = require('cheerio');
const readline = require('readline');
const path = require('path');
const fs = require('fs');

let RequestContextKey = '';
let login = '';
let obfuscatedPhoneNumber = '';
let codeReceipt = '';
let authenticationKey = '';
let SAMLResponse = '';
let cookies = {};

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
      setCookie(result.headers['set-cookie']);
      
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

let postRequest = (options, urlEncodedData, shouldReturnBody = false) => {
  return new Promise((res, rej) => {
    let result = {
      responseBody: '',
      headers: {}
    };

    let postRequest = https.request(options, response => {
      console.log(`POST Request: ${options.hostname}${options.path}`);
      console.log(`Status: ${response.statusCode}`);

      result.headers = response.headers;
      setCookie(result.headers['set-cookie']);

      if (!shouldReturnBody) { res(result); return;}
      else { console.log('Fetching response body..'); }
      
      response.on('data', chunk => {
        result.responseBody += chunk;
        console.log(` --Chunk: ${chunk.length}`);
      });

      response.on('end', () => {
        if (response.statusCode !== 302 && response.statusCode !== 200) {
          fs.writeFile(path.join(__dirname, 'badResponse.html'), result.responseBody, err => {
            if (err) { console.log(err); }
          });
          rej(new Error('Bad response.'));
        }
        
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
module.exports.postRequest = postRequest;

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

let getRegisteredUserData = (username) => {
  return getRegisteredUsers().then(users => {
    console.log('Registered data: ', users[username]);
    if (users[username] && users[username]['amzn-idp-auth-key'] 
    && users[username]['amzn-idp-auth-token']) {
      cookies['amzn-idp-auth-key'] = users[username]['amzn-idp-auth-key'];
      cookies['amzn-idp-auth-token'] = users[username]['amzn-idp-auth-token'];
      return true;
    } else {
      return false;
    }
  });
};

let submitUsername = () => {
  console.log('\n');
  console.log(`Attempting to POST login id: ${login}.`);

  const data = queryString.stringify({
    login: login,
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
      'Cookie': buildCookieString(cookies)
    }
  };

  return postRequest(options, data, true).then(pwSubmission => {
    let $ = cheerio.load(pwSubmission.responseBody);
    SAMLResponse = $('input[name="SAMLResponse"]').attr().value;
  });
};

let getEsspSession = () => {
  console.log('\n');
  const data = queryString.stringify({
    SAMLResponse: SAMLResponse
  });

  let options = {
    hostname: 'hub.amazon.work',
    path: '/saml/acs',
    method: 'POST',
    headers: {
      'Content-Length': data.length,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': buildCookieString(cookies)
    }
  };

  return postRequest(options, data, false);
};

let buildCookieString = (authData) => {
  let authKeyString = '';
  for (let key in authData) {
    authKeyString += `${key}=${authData[key]}; `;
  }

  return authKeyString;
};
module.exports.buildCookieString = buildCookieString;

let setCookie = (cookieArr) => {
  if (!cookieArr) { return; }

  console.log('set-cookie:');
  console.log(cookieArr);

  for (let i = 0; i < cookieArr.length; ++i) {
    let cookie = cookieArr[i].split(';')[0].split('=');
    cookies[cookie[0]] = cookie[1];
  }
};

let getRegisteredUsers = () => {
  return new Promise((res, rej) => {
    fs.readFile(path.join(__dirname, 'users.json'), (err, data) => {
      if (err) { rej(err); return; }

      res(JSON.parse(data));
    });
  }).catch(err => {
    if (err.code === 'ENOENT') {
      return {};
    }
  });
};

let addNewUser = (newUser) => {
  if (!newUser) { return; }
  
  let idp = {
    'amzn-idp-auth-key': newUser.cookies['amzn-idp-auth-key'],
    'amzn-idp-auth-token': newUser.cookies['amzn-idp-auth-token']
  };

  getRegisteredUsers().then(users => {
    users[newUser.login] = idp;
    let stringifiedUsers = JSON.stringify(users);
    return stringifiedUsers;
  }).then(updatedUsersString => {
    return new Promise((res, rej) => {
      fs.writeFile(path.join(__dirname, 'users.json'), updatedUsersString, (err) => {
        if (err) { rej(err); return; }
        console.log(`Successfully saved user: ${newUser.login}`);
        res();
      });
    });
  });
};

let loginPrompt = () => {
  return inputUserName()
    .then(getRegisteredUserData)
    .then(isRegistered => {
      console.log(`Is registered: ${isRegistered}.`);
      if (isRegistered) {
        return submitUsername()
          .then(inputPassword)
          .then(submitPassword);
      } else {
        return submitUsername()
          .then(selectPhone)
          .then(requestVerificationCode)
          .then(inputVerificationCode)
          .then(submitVerificationCode)
          .then(inputPassword)
          .then(submitPassword);
      }
    });  
};

module.exports.getAuthKeys = () => {
  return getSAMLRedirect()
    .then(getRequestContextKey)

    .then(inputUserName)
    .then(submitUsername)
    .then(selectPhone)
    .then(requestVerificationCode)
    .then(inputVerificationCode)
    .then(submitVerificationCode)
    .then(inputPassword)
    .then(submitPassword)
    
    .then(getEsspSession)
    // .then(() => {
    //   let user = {};
    //   user.login = login;
    //   user.cookies = cookies;
    //   // addNewUser(user);
    // })
    .then(() => {
      console.log('\nAuthentication complete.\n');

      return cookies;
    })
    .catch(console.error);
};