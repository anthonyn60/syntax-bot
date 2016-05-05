var https = require('https');
var restify = require('restify');
var builder = require('botbuilder');

// Create bot and add dialogs
var syntaxBot = new builder.BotConnectorBot({ appId: 'YourAppId', appSecret: 'YourAppSecret' });
syntaxBot.add('/', new builder.CommandDialog()
    .matches('link', function(session) {
        if(session.userData.concept) sendLink(session);
        else {
            session.send("Sorry, you haven't asked for any syntax to link to. If you're looking for a link to SyntaxDB, here it is: https://syntaxdb.com");
        }
    })
    .matches('example|sample', function(session){
        if(session.userData.concept) sendExample(session);  
        else {
            session.send("Sorry, you haven't asked for any syntax so I can't provide you with an example.");
            builder.DialogAction.beginDialog('/getSyntax');
        }
    })
    .matches("other|another|different|something else", function(session){
        if(session.userData.allConcepts != null && session.userData.current < session.userData.allConcepts.length - 1) {
            session.userData.concept = session.userData.allConcepts[session.userData.current + 1];
            session.send("Okay, here's another. This is the syntax for " + session.userData.concept.concept_search + ":\n\n" + session.userData.concept.syntax);
            session.userData.current += 1;
        }
        else if(session.userData.concepts != null || session.userData.concept) {
            session.send("Sorry, I've run out of results for you.");
        } else {
            session.send("Sorry, I can't give you results if you haven't provided me with syntax. Type 'syntax' to get started.")
        }
    })
    .matches('syntax', builder.DialogAction.beginDialog('/getSyntax'))
    .matches('help', function(session) {
        if(session.userData.concept) session.send("Type 'example' to get an example, 'link' to get a link to the concept, or 'another' to get a different result.\n\n You can also search for something else by typing 'syntax'.");
        else session.send("Type 'syntax' to begin.");
    })
    .onDefault(function(session) {
        if(session.userData.concept) session.send('You can ask for an example or a link to the page, or you can ask for another concept by asking for syntax.');
        else session.send('Hey there, I\'m the syntax box! Ask me for syntax to begin.');
    })
);

syntaxBot.add('/getSyntax', [
    function(session) {
        builder.Prompts.text(session, 'What syntax are you looking for?');
    },
    function(session, results) {
        session.userData.syntaxQuery = results.response;
        var apiLink = "https://syntaxdb.com/api/v1/concepts/search?q=" + encodeURIComponent(session.userData.syntaxQuery).toString();
        findConcept(apiLink, session);
    }
]);

function sendLink(session){
    session.send("Okay, here's the link: " + "https://syntaxdb.com/ref/" + session.userData.concept.language_permalink + '/' + session.userData.concept.concept_permalink);
}

function sendExample(session){
    session.send("Sure, here's an example:\n\n" + session.userData.concept.example);
}

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
                            session.send("Here's the " + concepts[0].concept_search + " syntax: \n\n" + concepts[0].syntax);
                            session.endDialog();
                        } else {
                            session.send("Sorry, I could find the syntax for what you just searched. Hopefully I'll be able to some time in the near future.");
                        }
                    })
                });
}

// Setup Restify Server
var server = restify.createServer();
server.post('/api/messages', syntaxBot.verifyBotFramework(), syntaxBot.listen());
server.listen(process.env.port || 3978, function () {
    console.log('%s listening to %s', server.name, server.url); 
});