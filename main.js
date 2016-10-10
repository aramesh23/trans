var dotenv = require('dotenv').config({path: './envVariable.env'});
var express = require('express');
var app = express();
googleTranslate = require('googleTranslate')(process.env.GOOGlE_API_KEY);
var moment = require('moment-timezone');
var _ = require('underscore');
var sleep = require('sleep');

var currHunSecTextCount = 0;
var perHundredSecAllowedCharLimit = 30000; //todo add actual perHunderd character limit(2M)
var timeWhenTranlsCallComp = '';

var currPerDayTextCount = 0;
var dateAtWhichPerDayLimitComple = '';
var perDayAllowedCharacterLimit = 500000; //todo add perDay character limit (50M)

var resetSecCharLimitAfterSec = 100; //make it 100 for testing it's 5
var currentTime = 0;
var timeOutSecond = 30; //todo change it to 30
var waitForSec = 30;

var maxAllowedCharToTranslate = 10000;

var mongoose = require('mongoose');
mongoose.connect(process.env.MONGO_DB_URL); //mongoose.connect('mongodb://localhost/nodeDb');
var traslationDatabase = mongoose.model(process.env.DB_NAME, new mongoose.Schema({en: String,fa: String,ru: String,ar: String,tr: String}));
var appTokenAuthe = mongoose.model('appAuthentication', new mongoose.Schema({appId: String,tokenId:String}));

var sync = require('synchronize');
var fiber = sync.fiber;
var await = sync.await;
var defer = sync.defer;

app.get('/getTranslation',function(req,res){

    var timeWhenTranStart = getCurrentDateTimeByPstTimeZone();
    var apiParameters = req.query;
    var fieldsRequiredTranslation = apiParameters.arrayToTranslate;
console.log(req+" 00000 "+fieldsRequiredTranslation);	
    var sourceLang = apiParameters.sourceLang;
    var targetLang = apiParameters.targetLang;
    var arrayNotRequireTranslation = [];
    var arrayThatRequireTranslation =[];
    var translatedValueThatHaveTranInDb = [];
    var haveSourceLangNotTargetLang = [];
    var valueThatContainsHtmlTag = [];
    var appId = apiParameters.appId;
    var tokenId = apiParameters.tokenId;
    var fieldsWithoutHtmlTagReqTrans = [];

    /*
        #checks if current appid and token id has access request of translation utitlity
    */
    appTokenAuthe.findOne({appId:appId,tokenId:tokenId, isActive: true},function(err,result){
        if(err) {
            return res.send(JSON.stringify(getErrorMessageByCode(420)));          
        }
        else {
            /*
              #makes array that required transaltion and that don't require translation and that have already translation in dabase
             */
            if(result) {

                if(sourceLang==targetLang){
                    return res.send(JSON.stringify(getErrorMessageByCode(421)));
                }

                var promises = fieldsRequiredTranslation.map(function(value) {
                    return new Promise(function(resolve, reject) {
                        var containsHtmlTag = fetchStringAndHtmlTag(value)
                        if(containsHtmlTag){
                            var textWithoutHtmlTag = containsHtmlTag.textWithoutHtmlTag;
                            valueThatContainsHtmlTag[textWithoutHtmlTag] = containsHtmlTag;
                            value = textWithoutHtmlTag
                        }
console.log(req.query+"   1111 IN");
                        fieldsWithoutHtmlTagReqTrans.push(value);

                        var queryToFindTranlation = {};
                        queryToFindTranlation[sourceLang] = value;

                        traslationDatabase.findOne(queryToFindTranlation,function (err, dbValue) {
console.log(req.query+"   2222 IN");
                            if (dbValue && dbValue[targetLang]) {
                                arrayNotRequireTranslation.push(value);
                                translatedValueThatHaveTranInDb.push(dbValue[targetLang])
                            }
                            else if(dbValue && !dbValue[targetLang]) {
                                haveSourceLangNotTargetLang.push(value);
                                arrayThatRequireTranslation.push(value);
                            }
                            else
                                arrayThatRequireTranslation.push(value)
                            resolve();
console.log(req.query+"   2222 OUT");                            
                        });
console.log(req.query+"   1111 OUT");
                    });
                });

                Promise.all(promises)
                    .then(function() {
console.log(req.query+"   3333 IN");
                        iterateForRetry();
console.log(req.query+"   3333 OUT");                        
                    })
                    .catch(console.error);
            }
            else {
                return res.send(JSON.stringify(getErrorMessageByCode(401)));
            }
        }
    })

    iterateForRetry = function(){

        checkPerDayLimit();
        checkPerHundSecLimit();

        var arrayCharSizeToTranslate = getCharacterCountOfArray(arrayThatRequireTranslation);
        var remainingPerDayText = perDayAllowedCharacterLimit - currPerDayTextCount;
        var remainCharToTransInHundSec = perHundredSecAllowedCharLimit - currHunSecTextCount;

        if (arrayCharSizeToTranslate < remainingPerDayText) {
console.log(req.query+"   4444 IN");
            if (arrayCharSizeToTranslate <= remainCharToTransInHundSec) {
console.log(req.query+"   5555 IN");            	
                if (_.size(arrayThatRequireTranslation) > 0) {
console.log(req.query+"   6666 IN");                	
                    fiber(function () {            
console.log(req.query+"   7777 IN");                    	          
                        var translationData = getTextUsingGoogleTranslate(arrayThatRequireTranslation);
console.log(req.query+"   7777 OUT"+ translationData);
                        return res.send(translationData);
                    });
console.log(req.query+"   6666 OUT");                    
                }
                else {                   
console.log(req.query+"   66666 IN");                	
                    var translationDataDB =  getResponseOfTran();
console.log(req.query+"   66666 OUT"+translationDataDB);                    
                    return res.send(translationDataDB);
                }
            }
            else {

                /*
                    # if per second limit is completed than it waith for allowed "waitForSec"
                    # when here comes it wait for some time
                 */
                var timeAfterWhenLimitCompFor100Sec = Math.floor((timeWhenTranStart - timeWhenTranlsCallComp) / 1000)
                var waitUntiHunSecLimit = resetSecCharLimitAfterSec - timeAfterWhenLimitCompFor100Sec;
                if (waitUntiHunSecLimit <= waitForSec) {
                    sleep.sleep(waitUntiHunSecLimit);
                    currHunSecTextCount = 0;
                    timeWhenTranlsCallComp = '';
                }
                else {
                    return res.send(JSON.stringify(getErrorMessageByCode(418)));
                }

                fiber(function () {
                    var isLimitComplete = true;
                    var translationData = getTextUsingGoogleTranslate(arrayThatRequireTranslation, isLimitComplete);
                    return res.send(translationData);
                });
            }
        }
        else {
            var modifiedArrayToTranslate = getArrayThatCanTranslate(arrayThatRequireTranslation, remainingPerDayText);
            if (_.size(modifiedArrayToTranslate) > 0) {
                fiber(function () {
                    var translationData = getTextUsingGoogleTranslate(arrayThatRequireTranslation);
                    return res.send(translationData);
                });
            }
            else {
                if (!dateAtWhichPerDayLimitComple)
                    dateAtWhichPerDayLimitComple = getDateByTimeZone();
               
                return res.send(JSON.stringify(getErrorMessageByCode(419)));
            }
        }
    }

    /*
     # insert's translation into dabase
     */
    insertUpdateTranInDb = function(transResult, isLimitComplete) {
        fieldsWithoutHtmlTagReqTrans.forEach(function (value) {
            if(_.size(transResult) > 0) {
                if (_.contains(haveSourceLangNotTargetLang, value)) {
                    //source language already in database but target language not database so require updation
                    var getTrans = transResult[_.indexOf(arrayThatRequireTranslation, value)];

                    if(getTrans) {
                        var translateByLang = {};
                        translateByLang[targetLang] = getTrans;

                        var updateQuery = {};
                        updateQuery[sourceLang] = value;
                        //modalName.update
                        traslationDatabase.update(updateQuery, translateByLang, function (err) { });
                    }
                }
                else {
                    //source text that are not already in database we need to insert it in database
                    var getTransValue = transResult[_.indexOf(arrayThatRequireTranslation, value)];
                    if(getTransValue) {
                        var translateByLang = {};
                        translateByLang[sourceLang] = value;
                        translateByLang[targetLang] = getTransValue;
                        var googleTranslateDb = new traslationDatabase(translateByLang);
                        googleTranslateDb.save(function (err) {
                        });
                    }
                }
            }
        });
        return (isLimitComplete) ? getErrorMessageByCode(423) : getResponseOfTran(transResult);
    }

    /*
        # given response of google tranalstion to end user
     */
    getResponseOfTran = function(transResult) {
        var mainTranslatedArray =[];
        var keyThatContainsHtmlTag = _.keys(valueThatContainsHtmlTag)
        fieldsWithoutHtmlTagReqTrans.forEach(function (value) {
            //the fields which has already translation in database will get value from datbase
            var startHtmlTag = '';
            var endHtmlTag = '';
            if(_.contains(keyThatContainsHtmlTag,value)) {
                startHtmlTag = valueThatContainsHtmlTag[value]['startHtmlTag'];
                endHtmlTag = valueThatContainsHtmlTag[value]['endHtmlTag'];
            }

            if (_.contains(arrayNotRequireTranslation, value)) {
                mainTranslatedArray.push({
                    translatedText: startHtmlTag+translatedValueThatHaveTranInDb[_.indexOf(arrayNotRequireTranslation, value)]+endHtmlTag,
                    originalText: startHtmlTag+value+endHtmlTag
                });
            }
            else {
                if(_.size(transResult) > 0) {
                    var getTransValue = transResult[_.indexOf(arrayThatRequireTranslation, value)];
                    mainTranslatedArray.push({originalText: startHtmlTag+value+endHtmlTag, translatedText: startHtmlTag+getTransValue+endHtmlTag});
                }
            }
        });
        return  JSON.stringify({translateCode: 200, translatedData: mainTranslatedArray});
    }

    /*
        # Translate array using google translator
     */
    getTextUsingGoogleTranslate = function(fieldsForTrans, isLimitComplete){
        currentTime = getCurrentDateTimeByPstTimeZone();
        try {
            var translation = await(googleTranslate.translate(arrayThatRequireTranslation, sourceLang, targetLang, defer()));
            timeWhenTranlsCallComp = getCurrentDateTimeByPstTimeZone();

            if (isTimeout(currentTime, timeWhenTranlsCallComp, timeOutSecond)) {
                return JSON.stringify(getErrorMessageByCode(408));
            }

            updateCurrentTextCount(fieldsForTrans)

            var transResult = convertTransObjectToTranTextArray(translation);

            if(_.size(transResult) <=0) {
                return JSON.stringify(getErrorMessageByCode(422));
            }
            else {
                var newValue = insertUpdateTranInDb(transResult, isLimitComplete);
                return newValue;
            }
        }
        catch(e){
            return e;
        }
    }

    checkPerDayLimit = function() {
        if (dateAtWhichPerDayLimitComple && (dateAtWhichPerDayLimitComple != getDateByTimeZone())) {
            dateAtWhichPerDayLimitComple = '';
            currPerDayTextCount = 0;
            timeWhenTranlsCallComp = '';
            timeWhenTranStart = getCurrentDateTimeByPstTimeZone();
        }
    }

    checkPerHundSecLimit = function() {
        if (getDiffeOfTwoDateInsec(timeWhenTranStart, timeWhenTranlsCallComp)  >= resetSecCharLimitAfterSec) {
            currHunSecTextCount = 0;
            timeWhenTranlsCallComp = '';
        }
    }

    updateCurrentTextCount = function(fieldsForTrans) {
        var sizeOfField = getCharacterCountOfArray(fieldsForTrans)
        currHunSecTextCount += sizeOfField;
        currPerDayTextCount += sizeOfField;
    }
});

/*
    #checks time taken of google to response translation is  less than allowed timeout sec
 */
isTimeout = function(oldTime, newTime , timeOutSecond) {
    return getDiffeOfTwoDateInsec(oldTime, newTime) > timeOutSecond
}

/*
    #take translated object in form obj {translateText:'',origionaltext:''} and fetch only translated text and convert to array
 */
convertTransObjectToTranTextArray = function(translation) {
    var translationArr = []
    if(_.isArray(translation)) {
        translationArr = translation;
    }
    else {
        translationArr.push(translation);
    }

    var transResult = [];
    if(_.size(translationArr) > 0) {
        translationArr.forEach(function (value) {
            var transValue = value && value.translatedText ? value.translatedText : '';
            transResult.push(transValue);
        })
    }
    return transResult;
}

/*
    #contains list of error message with error code
 */
getErrorMessageByCode = function(errCode){
    var erroRMessageByCode = {
        408:{translateCode: 408, message:'TIMEOUT'},
        418:{translateCode: 418, message:'PER_HUNSEC_LIMIT_COMPLETE'},
        419:{translateCode: 419, message:'PER_DAY_LIMIT_COMPLETE'},
        401:{translateCode: 401, message: 'UNAUTHORIZED_USER'},
        420:{translateCode: 420, message: 'ERROR_DB'},
        421:{translateCode: 421, message: 'SOURCE_TARGET_SAME'},
        422:{translateCode: 422, message: 'ALL_FIELD_NOT_TRANSLATED'},
        423:{translateCode: 422, message: 'TRANS_REQUEST_TIMEOUT_PLZ_RETRY'}
    }
    return erroRMessageByCode[errCode]
}

/*
   #convert objects to array
 */
convertObjectToArray = function(translation) {
    var convertToArray = [];
    convertToArray.push(translation);
    return convertToArray
}

/*
    #counts characte length of array object
 */
getCharacterCountOfArray = function(arrayText) {
    var sizeOfChar = 0;
    arrayText.forEach(function (arrayValue) {
        sizeOfChar += _.size(arrayValue)
    })
    return sizeOfChar;
}

/*
    #gets array that can be translated in remaining limit
 */
getArrayThatCanTranslate = function(arrayThatRequireTranslation,remainingCharToAllowTranslate) {
    var fetchArrayToTrans = [];
    var numberOfModifiedCharToTranslate = 0;
    arrayThatRequireTranslation.forEach(function(value){
        numberOfModifiedCharToTranslate += _.size(value);
        if(numberOfModifiedCharToTranslate <= remainingCharToAllowTranslate) {
            fetchArrayToTrans.push(value);
        }
    });
    return fetchArrayToTrans;
}

/*
    #fetch's date by time zone ,because google reset limit based on pacifice time zone so here America/Los_Angeles is taken
 */
getDateByTimeZone = function(){
    return (moment(new Date()).tz("America/Los_Angeles").format('YYYY-MM-DD'));
}

/*
    #if there is start and end html tag than this function will fetch starthtmltag, endhtmltag, and text to translate
*/
fetchStringAndHtmlTag = function(param) {
    var indexOfFirstLtTag = param.indexOf('<');
    var indexOfLastGtTag = param.lastIndexOf('>');
    var sizeOfParam = _.size(param)

    if (indexOfFirstLtTag == 0 && indexOfLastGtTag == (sizeOfParam - 1)) {
        var indexOfFirstGtTag = param.indexOf('>');
        var indexOfLastLtTag = param.lastIndexOf('<');
        var sizeOfEndHtmlTag = _.size(param.substr(indexOfLastLtTag, indexOfLastGtTag + 1));
        var startHtmlTag = param.substr(indexOfFirstLtTag, indexOfFirstGtTag + 1);
        var endHtmlTag = param.substr(indexOfLastLtTag, sizeOfEndHtmlTag + 1);
        var textWithoutHtmlTag = param.substr(indexOfFirstGtTag + 1, (indexOfLastLtTag) - (indexOfFirstGtTag + 1))

        return {
            startHtmlTag: startHtmlTag,
            endHtmlTag: endHtmlTag,
            textWithoutHtmlTag: textWithoutHtmlTag
        }
    }
}

getCurrentDateTimeByPstTimeZone = function() {
    return (moment(new Date()).tz("America/Los_Angeles").format('DD HH:mm:ss'));
}

addHusSecInCurrentDateTimeByPstTimeZone = function(addSec){
    return (moment(new Date()).startOf('second').add(addSec, 'second').tz("America/Los_Angeles").format('DD HH:mm:ss'));
}

getDiffeOfTwoDateInsec = function(oldTime, newTime) {
    var startTime = moment( oldTime , 'DD HH:mm:ss');
    var endTime = moment( newTime , 'DD HH:mm:ss');
    return endTime.diff(startTime, 'seconds');
}

var server = app.listen(process.env.PORT, function () {
    console.log("Utility started at "+process.env.PORT);
})