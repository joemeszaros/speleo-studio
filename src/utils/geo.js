class Declination {

  static async getDeclination(lat, long, date, timeoutInMs = 3000) {
    const url = 'https://www.ngdc.noaa.gov/geomag-web/calculators/calculateDeclination';
    const params = new URLSearchParams();
    params.append('lat1', lat);
    params.append('lon1', long);
    params.append('resultFormat', 'json');
    params.append('startMonth', date.getMonth() + 1);
    params.append('startDay', date.getDate());
    params.append('startYear', date.getFullYear());
    params.append('model', 'IGRF');
    params.append('key', 'zNEw7');
    console.log(params);
    const start = Date.now();
    const response = await fetch(`${url}?${params}`, { signal: AbortSignal.timeout(timeoutInMs) });
    console.log(`Request took ${Date.now() - start}ms`);

    if (!response.ok) {
      throw new Error(`Response status: ${response.status}`);
    }

    return response.json().then((json) => json.result[0].declination);
  }
}

export { Declination };
