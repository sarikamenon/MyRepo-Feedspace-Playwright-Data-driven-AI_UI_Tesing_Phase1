process.env.WIDGET_DATA = JSON.stringify({
  "data": {
    "configurations": {
      "allow_to_display_feed_date": "1",
      "is_show_indicators": "1",
      "is_show_ratings": "1",
      "show_platform_icon": 1
    },
    "type": "carousel_slider",
    "url": "https://www.nailstudio-basel.ch/"
  }
});

// Since the runner is a self-invoking async function called at the top level 
// but we want to run it from here, we will just require it.
// Note: runApiValidation.ondemand.js calls run() at the end.
require('../runners/runApiValidation.ondemand.js');
