import express, { Request, Response } from "express";
import axios from "axios";
import { Redis } from "../../../lib/reddis.ts";

const router = express.Router();

function getAllBusDetails(bus) {
  // Handle the case where predictions is an object instead of an array
  const predictionsData = bus.data.predictions;
  let predictionsArray = [];

  // Check if predictions is an array or a single object
  if (Array.isArray(predictionsData)) {
    predictionsArray = predictionsData;
  } else if (predictionsData && typeof predictionsData === "object") {
    predictionsArray = [predictionsData];
  }

  // Find the first route with directions
  const filteredRoute = predictionsArray.find((item) => item.direction) || {};

  // Default structure for the output
  let upcomingBusDetails = {
    routeTitle: filteredRoute.routeTitle || "",
    prediction: [], // Default to empty array
  };

  // If no direction data is found, return the default structure
  if (!filteredRoute.direction) {
    return upcomingBusDetails;
  }

  let directionData = filteredRoute.direction;

  // Case 1: direction is an array of objects, each with a 'prediction' property
  if (Array.isArray(directionData)) {
    let allPredictions = [];

    directionData.forEach((dir) => {
      // Handle case where prediction is an object or an array
      if (dir.prediction) {
        const predictions = Array.isArray(dir.prediction)
          ? dir.prediction
          : [dir.prediction];
        const formattedPredictions = predictions.map((p) => ({
          time: p?.seconds || null,
          branch: p?.branch || null,
        }));
        allPredictions = [...allPredictions, ...formattedPredictions];
      }
    });

    upcomingBusDetails = {
      routeTitle: filteredRoute.routeTitle || "",
      prediction: allPredictions,
    };
  }
  // Case 2: direction is a single object with 'prediction' property
  else if (directionData && typeof directionData === "object") {
    // Handle case where prediction is an object or an array
    const predictionData = directionData.prediction;
    if (!predictionData) {
      return upcomingBusDetails;
    }

    const predictionArray = Array.isArray(predictionData)
      ? predictionData
      : [predictionData];
    const filteredRouteTimings = predictionArray.map((bus) => ({
      time: bus?.seconds || null,
      branch: bus?.branch || null,
    }));

    upcomingBusDetails = {
      routeTitle: filteredRoute.routeTitle || "",
      prediction: filteredRouteTimings,
    };
  }

  return upcomingBusDetails;
}

async function fetchBusStops(req: Request, res: Response) {
  try {
    const response = await Redis.get("stops");

    const stops = JSON.parse(response);

    const responses = await Promise.allSettled(
      stops.map((stop) =>
        axios.get(
          `http://webservices.nextbus.com/service/publicJSONFeed?command=predictions&a=ttc&stopId=${stop}`
        )
      )
    );
    const filter = responses.filter((res) => res.status === "fulfilled");

    const upcomingBusDetails = filter
      .map((res) => {
        if (res.status === "fulfilled") {
          return getAllBusDetails(res.value);
        }
      })
      .filter(Boolean); // Filter out any undefined values

    res.status(200).json({
      data: { times: upcomingBusDetails || [], stops: stops || "" },
    });
  } catch (error) {
    console.log(error);
    res.status(200).json({ error });
  }
}

router.get("/bus-times", fetchBusStops);

export default router;
