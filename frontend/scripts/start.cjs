// Keep the retained CRA dev server on loopback by default. Docker serves production assets.
process.env.HOST ||= '127.0.0.1'
require('react-scripts/scripts/start')
