// let envObj, ballObj, physObj, paramObj;

class Ball {
    constructor(mass, circ) {
        this.mass = mass;
        this.circ = circ;
    }
}

class Trajectory {
    constructor(positions) {
        this.positions = positions;
    }
}

class EnvConditions {
    constructor(tempF, elevFt, relHumidity, vWind, phiWind) {
        this.tempF = tempF;
        this.elevFt = elevFt;
        this.relHumidity = relHumidity;
        this.vWind = vWind;
        this.phiWind = phiWind;
    }

    //set temp(value) {
    //    this.tempF = value;
    //  }

}

class StartPosition {
    constructor(xFeet, yFeet, zFeet) {
        this.xFeet = xFeet;
        this.yFeet = yFeet;
        this.zFeet = zFeet;
    }
}

class Hit {
    constructor(exitVelo, launchAngle, sprayDir, hand, estimateSpin, backspin, sidespin) {
        this.exitVelo = exitVelo;
        this.launchAngle = launchAngle;
        this.sprayDir = sprayDir;
        this.hand = hand;
        this.estimateSpin = estimateSpin;
        this.backspin = backspin;
        this.sidespin = sidespin;
    }

    static beta = 0.0001217;

    calcTrajectory(envObj, ballObj, startPosition) {
        const dt = 0.01;

        let sign;
    
        if (this.hand == "L") {
            sign = -1;
        }
    
        if (this.hand == "R") {
            sign = 1;
        }
    
    
        let exitVelo = this.exitVelo;
        if (exitVelo <= 0) {
            exitVelo = 0.01;
        }
        const phi = this.sprayDir;
        const launchAngle = this.launchAngle;
        let backspin = this.backspin;
        let sidespin = this.sidespin;
    
        if (this.estimateSpin == true) {
            backspin = -763 + (120 * launchAngle) + (21 * phi * sign);
            sidespin = -sign * 849 - 94 * phi;
            this.backspin = backspin;
            this.sidespin = sidespin;
            // input_backspin.value = this.backspin.toFixed(0);
            // input_sidespin.value = this.sidespin.toFixed(0);
        }
    
        if (sidespin == 0) {
            sidespin = 0.1;
        }
    
        const mass = ballObj.mass;
        const circ = ballObj.circ;
    
        const temp = (5 / 9) * (envObj.tempF - 32);
        const elev = envObj.elevFt / 3.2808;
        const relHumidity = envObj.relHumidity;
        const vWind = envObj.vWind;
        const phiWind = envObj.phiWind;
    
        const elevFt = envObj.elevFt;
    
        const g = 32.174; // gravity
    
        const beta = 0.0001217;
    
        const pressure_hg = 29.92;
    
        const wg = 0;
        const tau = 10000;
    
        // const hwind = 0;
    
        const pressure = pressure_hg * 1000 / 39.37;
        const SVP = 4.5841 * Math.exp((18.687 - temp / 234.5) * temp / (257.14 + temp));
        const relHumidity_kg = 1.2929 * (273 / (temp + 273) * (pressure * Math.exp(-beta * elev) - 0.3783 * relHumidity * SVP / 100) / 760);
        const relHumidity_lb = relHumidity_kg * 0.06261;
    
        const c0 = 0.07182 * relHumidity_lb * (5.125 / mass) * Math.pow((circ / 9.125), 2);
        const c0_const = c0;
        const K = c0_const;
        //const Re = relHumidity_kg * 44.7 * (circ / (Math.PI * 39.37)) * ((temp + 273.16 + 120) / (0.000001512 * Math.pow((temp + 273.16), 1.5)));
    
        const spin = Math.sqrt(Math.pow(backspin, 2) + Math.pow(sidespin, 2));
    
        const v0 = exitVelo * 1.467;
        const v0x = exitVelo * 1.467 * Math.cos(launchAngle * Math.PI / 180) * Math.sin(phi * Math.PI / 180);
        const v0y = exitVelo * 1.467 * Math.cos(launchAngle * Math.PI / 180) * Math.cos(phi * Math.PI / 180);
        const v0z = exitVelo * 1.467 * Math.sin(launchAngle * Math.PI / 180);
    
        const vxw = vWind * 1.467 * Math.sin(phiWind * Math.PI / 180);
        const vyw = vWind * 1.467 * Math.cos(phiWind * Math.PI / 180);
    
        const vx = v0x;
        const vy = v0y;
        const vz = v0z;
        const v = v0;


        const x = startPosition.xFeet;
        const y = startPosition.yFeet;
        const z = startPosition.zFeet;
    
        const wx = (backspin * Math.cos(phi * Math.PI / 180) - sidespin * Math.sin(launchAngle * Math.PI / 180) * Math.sin(phi * Math.PI / 180) + wg * v0x / v0) * Math.PI / 30;
        const wy = (-backspin * Math.sin(phi * Math.PI / 180) - sidespin * Math.sin(launchAngle * Math.PI / 180) * Math.cos(phi * Math.PI / 180) + wg * v0y / v0) * Math.PI / 30;
        const wz = (sidespin * Math.cos(launchAngle * Math.PI / 180) + wg * v0z / v0) * Math.PI / 30;
    
        let w = Math.sqrt(Math.pow(wx, 2) + Math.pow(wy, 2) + Math.pow(wx, 2));
    
        const omega = Math.sqrt(Math.pow(backspin, 2) + Math.pow(sidespin, 2)) * (Math.PI / 30);
        const romega = (circ / 2 / Math.PI) * omega / 12;
    
        const vw0 = Math.sqrt(Math.pow((v0x - vxw), 2) + Math.pow((v0y - vyw), 2) + Math.pow(v0z, 2))

        let S = romega / vw0;
    
        const cl0 = 0.583;
        const cl1 = 2.333;
        const cl2 = 1.120;
    
        const cd0 = 0.3008;
        const cdspin = 0.0292;
    
        let cd = cd0 + cdspin * (spin / 1000);
        let cl = cl2 * S / (cl0 + cl1 * S);
    
        const tSteps = 10 / dt;
        let xArray = new Array(tSteps);
        let yArray = new Array(tSteps);
        let zArray = new Array(tSteps);
    
        const vxArray = new Array(tSteps);
        const vyArray = new Array(tSteps);
        const vzArray = new Array(tSteps);
    
        const vArray = new Array(tSteps);
    
        const vwArray = new Array(tSteps);
    
        const secArray = new Array(tSteps);
        const SArray = new Array(tSteps);
    
        xArray[0] = x;
        yArray[0] = y;
        zArray[0] = z;
    
        vxArray[0] = vx;
        vyArray[0] = vy;
        vzArray[0] = vz;
    
        vArray[0] = v;
    
        vwArray[0] = vw0;

    
        secArray[0] = 0;
        SArray[0] = S;
    
        let adragx = (-K * cd * vwArray[0] * (vxArray[0] - vxw));
        let adragy = (-K * cd * vwArray[0] * (vyArray[0] - vyw));
        let adragz = (-K * cd * vwArray[0] * vzArray[0]);
    
        let aMagx = K * (cl / omega) * vwArray[0] * (wy * vzArray[0] - wz * (vyArray[0] - vyw));
        let aMagy = K * (cl / omega) * vwArray[0] * (wz * (vxArray[0] - vxw) - wx * vzArray[0]);
        let aMagz = K * (cl / omega) * vwArray[0] * (wx * (vyArray[0] - vyw) - wy * (vxArray[0] - vxw));
    
        let ax = adragx + aMagx;
        let ay = adragy + aMagy;
        let az = adragz + aMagz - g;
    
        let i = 0;
    
        while (zArray[i] >= -1) {
    
            cd = cd0 + cdspin * (spin / 1000) * Math.exp(-secArray[i] / (tau * 146.7 / vwArray[i]));
    
            cl = cl2 * SArray[i] / (cl0 + cl1 * SArray[i]);
    
            adragx = (-K * cd * vwArray[i] * (vxArray[i] - vxw));
            adragy = (-K * cd * vwArray[i] * (vyArray[i] - vyw));
            adragz = (-K * cd * vwArray[i] * vzArray[i]);
    
            w = omega * Math.exp(-secArray[i] / tau) * 30 / Math.PI;
    
            aMagx = K * (cl / omega) * vwArray[i] * (wy * vzArray[i] - wz * (vyArray[i] - vyw));
            aMagy = K * (cl / omega) * vwArray[i] * (wz * (vxArray[i] - vxw) - wx * vzArray[i]);
            aMagz = K * (cl / omega) * vwArray[i] * (wx * (vyArray[i] - vyw) - wy * (vxArray[i] - vxw));
    
            ax = adragx + aMagx;
            ay = adragy + aMagy;
            az = adragz + aMagz - g;
    
            xArray[i + 1] = xArray[i] + vxArray[i] * dt + 0.5 * ax * dt * dt;
            yArray[i + 1] = yArray[i] + vyArray[i] * dt + 0.5 * ay * dt * dt;
            zArray[i + 1] = zArray[i] + vzArray[i] * dt + 0.5 * az * dt * dt;
    
            vxArray[i + 1] = vxArray[i] + ax * dt;
            vyArray[i + 1] = vyArray[i] + ay * dt;
            vzArray[i + 1] = vzArray[i] + az * dt;
            vwArray[i + 1] = Math.sqrt(Math.pow((vxArray[i + 1] - vxw), 2) + Math.pow((vyArray[i + 1] - vyw), 2) + Math.pow(vzArray[i + 1], 2));
            vArray[i + 1] = Math.sqrt(Math.pow(vxArray[i + 1], 2) + Math.pow(vyArray[i + 1], 2) + Math.pow(vzArray[i + 1], 2));
    
            secArray[i + 1] = secArray[i] + dt;
    
            SArray[i + 1] = (romega / vwArray[i + 1]) * Math.exp(-secArray[i + 1] / (tau * 146.7 / vwArray[i + 1]));
    
            i++;
        }
    
        const negZ = (element) => element < 0;
        const end = zArray.findIndex(negZ);
        let end2 = end + 2
    
        xArray = xArray.slice(0, end2);
        yArray = yArray.slice(0, end2);
        zArray = zArray.slice(0, end2);

        // const lessThanTenFeet = (element) => element <= 10;
        // console.log(zArray);
        // console.log(zArray.forEach(element => element < 10));

        // subtracts 78.4 because that's where SVG loader places peak of home plate.
        const xAdjArray = xArray.map(function (element) {
            return (element / 2.4) + 0.2;
        });
    
        // subtracts 78.4 because that's where SVG loader places home plate.
        const yAdjArray = yArray.map(function (element) {
            return (element / 2.4) - 78.4;
        });

        const zAdjArray = zArray.map(function (element) {
            return element / 2.4;
        });
    
        const xVector = xAdjArray.slice(0, end);
        const yVector = yAdjArray.slice(0, end);
        const zVector = zAdjArray.slice(0, end);
    
        const distFeet = Math.sqrt(Math.pow(xArray[end], 2) + Math.pow(yArray[end], 2));
    
        const apexIndex = zVector.indexOf(Math.max(...zVector));
    
        const hitApex = zVector[apexIndex] * 2.4;

        const hangTime = secArray[end];
    
        let splashRadius = 27.18858 * hangTime - 48.33462;
    
        if (hangTime <= 3.00) {
            splashRadius = 2.445 * Math.pow(hangTime, 2) + 3.865 * hangTime - 0.163
        }
    
        const splashRadiusCoord = splashRadius / 2.4;
    
        // Pre-allocating positions array instead of using positions.push()
        const arrayLength = end;
        const positions = new Array(arrayLength * 3);
        const xy_coords = new Array(arrayLength * 3);
        let j = 0;
    
        let subIndex1 = 0;
        let subIndex2 = 1;
        let subIndex3 = 2;

        for (j = 0; j < end; j++) {
            subIndex1 = j * 3;
            subIndex2 = subIndex1 + 1;
            subIndex3 = subIndex1 + 2;
            positions[subIndex1] = xVector[j];
            positions[subIndex2] = yVector[j];
            positions[subIndex3] = zVector[j];
            xy_coords[subIndex1] = xVector[j];
            xy_coords[subIndex2] = positions[subIndex2];
            xy_coords[subIndex3] = 0.5;
        }
    
        const distFeetArray = new Array(arrayLength);
    
        for (let i = 0; i < arrayLength; i++) {
            distFeetArray[i] = Math.sqrt(Math.pow(xArray[i], 2) + Math.pow(yArray[i], 2));
          }
    
        const xEnd =  xAdjArray[end];
        const yEnd =  yAdjArray[end];

        const xStart =  xAdjArray[0];
        const yStart =  yAdjArray[0];
    
        const angDegArray = new Array(arrayLength);
    
        for (let i = 0; i < arrayLength; i++) {
            angDegArray[i] = -round(calcAngleDegrees(xArray[i], yArray[i], 0, 0), 1);
          }
    
        let angDeg = calcAngleDegrees(xEnd, yEnd);
        angDeg = round(angDeg, 1);
    
        const trajObject = {
            xEnd: xEnd,
            yEnd: yEnd,
            xStart: xStart,
            yStart: yStart,
            distFeet: distFeet,
            distFeetArray: distFeetArray,
            heightFeetArray: zArray,
            hangTime: hangTime,
            splashRadius: splashRadius,
            elevFt: elevFt,
            hitApex: hitApex,
            splashRadiusCoord: splashRadiusCoord,
            positions: positions,
            xy_coords: xy_coords,
            // correctedPositions: correctedPositions,
            angDeg: angDeg,
            angDegArray: angDegArray,
            yVec: yVector,
        }
        //return positions;
        return trajObject;
    }
}

function round(value, precision) {
    const multiplier = Math.pow(10, precision || 0);
    return Math.round(value * multiplier) / multiplier;
}

function calcAngleDegrees(x_end, y_end) {

    return Math.atan2(x_end, y_end) * (90 / Math.PI);
}



// paramObj = {
//     hitColor: 0x800020,
//     drawFillShapes: true,
//     elevFt: 21,
//     park: undefined,
//     currentURL: '/images/svg/bos.svg',
//     objURL: '/images/svg/bos.svg',
//     jsonURL: '/images/svg/bos.svg',
// };

export { Hit, EnvConditions, Ball, Trajectory, StartPosition };
// export { name, draw, reportArea, reportPerimeter };
// export default Hit;
