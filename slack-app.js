var https = require('https');
var botkit = require('botkit')
var builder = require('botbuilder');

var Redis_Store = require('./redis_storage.js');
var redis_url = "redis://127.0.0.1:6379";
var redis_store = new Redis_Store({url: redis_url});

// Create bot and add dialogs
var model = 'https://api.projectoxford.ai/luis/v1/application?id=f7fce781-ff77-4403-8c45-b5d3f5773643&subscription-key=6bb0629d272d45ab917873b75316b07a';
var dialog = new builder.LuisDialog(model);

if (!process.env.clientId || !process.env.clientSecret || !process.env.port) {
  console.log('Error: Specify clientId clientSecret and port in environment');
  process.exit(1);
}

var controller = botkit.slackbot({
  storage: redis_store,
}).configureSlackApp(
  {
    clientId: process.env.clientId,
    clientSecret: process.env.clientSecret,
    scopes: ['bot'],
  }
);

controller.setupWebserver(process.env.port,function(err,webserver) {
  controller.createWebhookEndpoints(controller.webserver);

  controller.createOauthEndpoints(controller.webserver,function(err,req,res) {
    if (err) {
      res.status(500).send('ERROR: ' + err);
    } else {
      res.send('Success!');
    }
  });
});

controller.on('create_bot',function(bot,config) {

  if (_bots[bot.config.token]) {
    // already online! do nothing.
  } else {
    bot.startRTM(function(err) {

      if (!err) {
        trackBot(bot);
        botInit(bot);
      }

      bot.startPrivateConversation({user: config.createdBy},function(err,convo) {
        if (err) {
          console.log(err);
        } else {
          convo.say("Hey, I'm the SyntaxBot! Search for any concept with the 'syntax' keyword.");
          convo.say('You must now /invite me to a channel so that I can be of use!');
        }
      });

    });
  }

});

var _bots = {};
function trackBot(bot) {
  _bots[bot.config.token] = bot;
}

function botAlreadyInit(bot){
  var syntaxBot = new builder.SlackBot(controller, bot);
      syntaxBot.add('/', dialog);
}

function botInit(bot){
    var syntaxBot = new builder.SlackBot(controller, bot);

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
                if(session.userData.queryConcept) session.userData.syntaxQuery = results.response + " " + session.userData.queryConcept;
                else if(session.userData.queryLanguage) session.userData.syntaxQuery = session.userData.queryLanguage + " " + results.response;
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

    dialog.on('ProfanityActivity', function(session){
      session.send("I don't appreciate that language.");
    });

    dialog.on('FinishActivity', function(session){
      session.send("Hope I was able to help. Goodbye!");
      session.endDialog();
    })

    dialog.on('HelpActivity', function(session){
      if(session.userData.concept){
             session.send('You can ask for an example or a link to the page, or you can ask for another concept by asking for syntax.');
           }
            else session.send('Ask for a concept and language with the \'syntax\' keyword to begin (i.e. for loop in java syntax).');
    })

    dialog.onDefault(function(session){
            if(session.userData.concept){
              session.send("Sorry, I didn't understand what you just said.");
             session.send('You can ask for an example or a link to the page, or you can ask for another concept by asking for syntax.');
           }
            else session.send('Sorry, I didn\'t understand what you just said. Ask me for syntax to begin.');
    })

    syntaxBot.listenForMentions();
}

/*
bot.startRTM(function(err,bot,payload) {
  if (err) {
    throw new Error('Could not connect to Slack');
  }
});
*/

controller.storage.teams.all(function(err,teams) {

  if (err) {
    throw new Error(err);
  }

  for (var t  in teams) {
    if (teams[t].bot) {
      var curBot = controller.spawn(teams[t]);
      curBot.startRTM(function(err, bot, payload) {
        if (err) {
          console.log('Error connecting bot to Slack:',err,bot);
        } else {
          trackBot(bot);
          botAlreadyInit(bot);
        }
      });
    } 
  }

});