var https = require('https');
var restify = require('restify');
var builder = require('botbuilder');

// Create bot and add dialogs
var model = 'https://api.projectoxford.ai/luis/v1/application?id=f7fce781-ff77-4403-8c45-b5d3f5773643&subscription-key=6bb0629d272d45ab917873b75316b07a';
var dialog = new builder.LuisDialog(model);
var syntaxBot = new builder.BotConnectorBot({ appId: 'syntax', appSecret: 'db42de4d8b6c4cb1886def57140570d0' });

syntaxBot.add('/', dialog);
dialog.on('SyntaxLookupActivity', [
    function(session, args, next){
        var concept = builder.EntityRecognizer.findEntity(args.entities, 'concept');
        var language = builder.EntityRecognizer.findEntity(args.entities, 'language');
        if(concept && language) {
            session.userData.syntaxQuery = concept.entity + " " + language.entity;
            next();
        } else if(concept) {
            session.userData.queryConcept = concept.entity;
            builder.Prompts.text(session, 'Which language would you like to search \'' + concept.entity + '\' in?');
        } else if(language) {
            session.userData.queryLanguage = language.entity;
            builder.Prompts.text(session, 'Which concept would you like to search in ' + language.entity + '?');
        } else {
            builder.Prompts.text(session, "Sure, what syntax are you looking for?");
        };
    },
    function(session, results) {
        if(results.response){
            if(session.userData.queryConcept) session.userData.syntaxQuery = results.response + " " + session.userData.queryLanguage;
            else if(session.userData.queryLanguage) session.userData.syntaxQuery = session.userData.queryConcept + " " + results.response;
            else session.userData.syntaxQuery = results.response;     
        }
        var apiLink = "https://syntaxdb.com/api/v1/concepts/search?q=" + encodeURIComponent(session.userData.syntaxQuery).toString();
        findConcept(apiLink, session);
    }
])

function findConcept(apiLink, session) {
    https.get(apiLink, function(response) {
                    var body = "";
                    response.on('data', function(results) {
                        body += results;
                    });
                    response.on('end', function(){
                        var concepts = JSON.parse(body);
                        if(concepts.length > 0) {
                            if(concepts.length > 1) {
                                session.userData.current = 0;
                                session.userData.allConcepts = concepts;
                            }
                            session.userData.concept = concepts[0];
                            session.send("Here's the " + concepts[0].concept_search + " syntax:");
                            session.send("```" + concepts[0].syntax + "```");
                            //session.endDialog();
                        } else {
                            var soLink = "http://stackoverflow.com/search?q=" + encodeURIComponent(session.userData.syntaxQuery).toString();
                            session.send("Sorry, I could find the syntax for what you just searched. Hopefully I'll be able to some time in the near future. In the meantime, here's a link to the same search on StackOverflow: " + soLink);
                        }
                    })
                });
}

dialog.on('ChangeLanguageActivity', [
          function(session, args, next){
                if(session.userData.concept) {
                    var language = builder.EntityRecognizer.findEntity(args.entities, 'language');
                    if(language) {
                        session.userData.language = language.entity;
                        next();
                    }
                    else {
                        builder.Prompts.text(session, 'What language would you like to switch to?');
                    }
                } else {
                    session.send("Sorry, I can't switch languages if there's no concept to switch for.");
                }
          }, function(session, results){
                if(results.response) session.userData.language = results.response;
                session.userData.syntaxQuery = session.userData.concept.concept_name + " " + session.userData.language;
                var apiLink = "https://syntaxdb.com/api/v1/concepts/search?q=" + encodeURIComponent(session.userData.syntaxQuery).toString();
                findConcept(apiLink, session);
          }
])

dialog.on('ExampleActivity', function(session){
        if(session.userData.concept){ session.send("Sure, here's an example:");
                session.send("```" + session.userData.concept.example + "```");
        }  
        else {
            session.send("Sorry, you haven't asked for any syntax so I can't provide you with an example.");
        }
})

dialog.on('LinkActivity', function(session){
        if(session.userData.concept) session.send("Okay, here's the link: " + "https://syntaxdb.com/ref/" + session.userData.concept.language_permalink + '/' + session.userData.concept.concept_permalink);
        else {
            session.send("Sorry, you haven't asked for any syntax to link to. If you're looking for a link to SyntaxDB, here it is: https://syntaxdb.com");
        }
})

dialog.on('DifferentConceptActivity', function(session){
     if(session.userData.allConcepts != null && session.userData.current < session.userData.allConcepts.length - 1) {
            session.userData.concept = session.userData.allConcepts[session.userData.current + 1];
            session.send("Okay, here's another. This is the syntax for " + session.userData.concept.concept_search + ":");
            session.send("```" + session.userData.concept.syntax + "```");
            session.userData.current += 1;
        }
        else if(session.userData.concepts != null || session.userData.concept) {
            session.send("Sorry, I've run out of results for you.");
        } else {
            session.send("Sorry, I can't give you results if you haven't provided me with syntax. Type 'syntax' to get started.")
        }
})

dialog.onDefault(function(session){
        if(session.userData.concept) session.send('You can ask for an example or a link to the page, or you can ask for another concept by asking for syntax.');
        else session.send('Hey there, I\'m the syntax box! Ask me for syntax to begin.');
})

// Setup Restify Server
var server = restify.createServer();
server.post('/api/messages', syntaxBot.verifyBotFramework(), syntaxBot.listen());
server.listen(process.env.port || 3978, function () {
    console.log('%s listening to %s', server.name, server.url); 
});