import express from "express";
import axios from "axios";
const router = express.Router();
function roundValue(value) {
    return `${value > 0 ? Math.ceil(value) : Math.floor(value)}\u00B0`;
}
async function getWeatherData(lat, lon) {
    const OPENWEATHER_API = process.env.OPENWEATHER_API;
    const urlForWeather = `https://api.openweathermap.org/data/3.0/onecall?lat=${lat}&lon=${lon}&appid=${OPENWEATHER_API}&units=metric`;
    const urlForAddress = `http://api.openweathermap.org/geo/1.0/reverse?lat=${lat}&lon=${lon}&limit=1&appid=${OPENWEATHER_API}`;
    const responseOfWeather = await axios.get(urlForWeather);
    const data = responseOfWeather.data;
    const responseOfAddress = await axios.get(urlForAddress);
    const weather = responseOfAddress.data[0].name;
    const weatherList = [];
    // Generate timestamps for current time, current + 8h, and current + 12h
    const now = new Date();
    const timestamps = [
        now,
        new Date(now.getTime() + 8 * 60 * 60 * 1000),
        new Date(now.getTime() + 12 * 60 * 60 * 1000),
    ];
    for (const time of timestamps) {
        const timestamp = time.toISOString();
        const targetTime = Math.floor(time.getTime() / 1000);
        if (time === now) {
            weatherList.push({
                timestamp,
                temperature: roundValue(data.current.temp),
                feels_like: roundValue(data.current.feels_like),
                description: data.current.weather[0].description,
                icon: `https://openweathermap.org/img/wn/${data.current.weather[0].icon}@2x.png`, // Added icon URL
                sunrise: data.current.sunrise, // Added sunrise
                sunset: data.current.sunset, // Added sunset
            });
        }
        else {
            // Find the closest hourly forecast to the requested time
            const closestHour = data.hourly.reduce((prev, curr) => Math.abs(curr.dt - targetTime) < Math.abs(prev.dt - targetTime)
                ? curr
                : prev);
            weatherList.push({
                timestamp,
                temperature: roundValue(closestHour.temp),
                feels_like: roundValue(closestHour.feels_like),
                description: closestHour.weather[0].description,
                icon: `https://openweathermap.org/img/wn/${closestHour.weather[0].icon}@2x.png`, // Added icon URL
            });
        }
    }
    return { WeatherData: weatherList, address: weather };
}
async function fetchWeatherForecast(req, res) {
    try {
        const { lat, long } = req.body;
        console.log(lat, long);
        // Parse and validate inputs
        const latNum = Number(parseFloat(lat));
        const lonNum = Number(parseFloat(long));
        const weatherData = await getWeatherData(latNum, lonNum);
        res.status(200).json({ data: weatherData });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error });
    }
}
router.post("/weather", fetchWeatherForecast);
export default router;
