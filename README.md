# MAHI Dashboard

## Frontend
React app in mahi-dashboard

npm i

npm run dev

## Backend
Run the MAHI-manet
sudo ./manet --fullconf manet.conf

Make sure you add

listener 1883
protocol mqtt
allow_anonymous true

listener 9001
protocol websockets
allow_anonymous true

to your mosquitto.conf
