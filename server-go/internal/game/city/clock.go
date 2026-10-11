package city

import (
	"errors"
	"math"

	"kartsim/internal/game/lobby"
)

// Weather states (CITY.md 2, 时钟与天气).
const (
	WeatherClear = "clear"
	WeatherRain  = "rain"
	WeatherSnow  = "snow"
)

// Weather segments last 5–15 minutes of node time.
const (
	weatherSegmentMin = 5 * 60 * 1000
	weatherSegmentMax = 15 * 60 * 1000
)

// cityClock is a line's day/night clock and weather state machine. Time of
// day advances linearly with the node clock (serverTick): timeOfDay =
// ((now + offset) mod dayLength) / dayLength, 0 midnight, 0.5 noon. The
// weather changes at weatherUntil: after clear comes rain (RainPercent),
// snow (SnowPercent) or clear again; after rain or snow, clear.
type cityClock struct {
	dayLengthMs int64
	offsetMs    int64
	weatherOn   bool
	rain, snow  int
	random      func() float64 // uniform in [0, 1)

	weather      string
	weatherUntil int64 // the segment's end (node ms); 0 when weather is off
	// forcedUntil: an admin set the weather until then (the machine resumes
	// with clear afterwards).
	forcedUntil int64
}

func newCityClock(now int64, dayLengthMs int64, weatherOn bool, rain, snow int, random func() float64) cityClock {
	k := cityClock{dayLengthMs: dayLengthMs, weatherOn: weatherOn, rain: rain, snow: snow, random: random,
		weather: WeatherClear}
	// A line starts at 08:00 so a fresh node is not in the dark.
	k.setTimeOfDay(now, 8.0/24)
	if weatherOn {
		k.weatherUntil = now + k.segment()
	}
	return k
}

func (k *cityClock) segment() int64 {
	return weatherSegmentMin + int64(k.random()*float64(weatherSegmentMax-weatherSegmentMin))
}

// timeOfDay is in [0, 1).
func (k *cityClock) timeOfDay(now int64) float64 {
	phase := (now + k.offsetMs) % k.dayLengthMs
	if phase < 0 {
		phase += k.dayLengthMs
	}
	return float64(phase) / float64(k.dayLengthMs)
}

// setTimeOfDay moves the clock so that now reads t (in [0, 1)).
func (k *cityClock) setTimeOfDay(now int64, t float64) {
	k.offsetMs = int64(math.Round(t*float64(k.dayLengthMs))) - now%k.dayLengthMs
}

// advance runs the weather machine at now; true when the weather changed.
func (k *cityClock) advance(now int64) bool {
	if !k.weatherOn || now < k.weatherUntil {
		return false
	}
	previous := k.weather
	if k.forcedUntil > 0 {
		k.forcedUntil = 0
		k.weather = WeatherClear
	} else if previous != WeatherClear {
		k.weather = WeatherClear
	} else {
		roll := k.random() * 100
		switch {
		case roll < float64(k.rain):
			k.weather = WeatherRain
		case roll < float64(k.rain+k.snow):
			k.weather = WeatherSnow
		default:
			k.weather = WeatherClear
		}
	}
	k.weatherUntil = now + k.segment()
	return k.weather != previous
}

// force sets the weather for durationMs (an admin command); 0 keeps it
// until the next natural change.
func (k *cityClock) force(now int64, weather string, durationMs int64) error {
	switch weather {
	case WeatherClear, WeatherRain, WeatherSnow:
	default:
		return errors.New("天气只能是 clear、rain 或 snow")
	}
	k.weather = weather
	if durationMs <= 0 {
		durationMs = k.segment()
	}
	k.weatherUntil = now + durationMs
	k.forcedUntil = k.weatherUntil
	if !k.weatherOn {
		// Weather is off: the forced weather stays until the next force.
		k.weatherUntil = 0
		k.forcedUntil = 0
	}
	return nil
}

// snapshot is the clock as the JSON messages carry it.
func (k *cityClock) snapshot(now int64) lobby.Object {
	return lobby.Object{
		lobby.F("serverTick", lobby.JDouble(float64(now))),
		lobby.F("timeOfDay", lobby.JDouble(k.timeOfDay(now))),
		lobby.F("dayLengthMs", k.dayLengthMs),
		lobby.F("weather", k.weather),
		lobby.F("weatherUntilTick", lobby.JDouble(float64(k.weatherUntil))),
	}
}
