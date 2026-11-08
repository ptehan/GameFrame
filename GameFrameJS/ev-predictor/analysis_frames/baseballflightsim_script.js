import * as THREE from '/scripts/node_modules/three/build/three.module.js';
import { OrbitControls } from '/scripts/node_modules/three/examples/jsm/controls/OrbitControls.js'
import { SVGLoader } from '/scripts/node_modules/three/examples/jsm/loaders/SVGLoader.js';
import { MeshLine, MeshLineMaterial } from '/node_modules/three.meshline/src/THREE.MeshLine.js';
import { OBJLoader } from '/scripts/node_modules/three/examples/jsm/loaders/OBJLoader.js';
import { Hit, EnvConditions, Ball, Trajectory, StartPosition } from '/hit_class_module.js';

const parkObject = {
    ARI: { elev: 1086, url: '/images/svg/ari.svg', objurl: '/assets/obj/ari.obj' },
    ATL: { elev: 1001, url: '/images/svg/atl.svg', objurl: '/assets/obj/atl.obj' },
    BAL: { elev: 33,   url: '/images/svg/bal.svg', objurl: '/assets/obj/bal.obj' },
    BOS: { elev: 21,   url: '/images/svg/bos.svg', objurl: '/assets/obj/bos.obj' },
    CHC: { elev: 595,  url: '/images/svg/chc.svg', objurl: '/assets/obj/chc.obj' },
    CIN: { elev: 535,  url: '/images/svg/cin.svg', objurl: '/assets/obj/cin.obj' },
    CLE: { elev: 653,  url: '/images/svg/cle.svg', objurl: '/assets/obj/cle.obj' },
    COL: { elev: 5190, url: '/images/svg/col.svg', objurl: '/assets/obj/col.obj' },
    CWS: { elev: 595,  url: '/images/svg/cws.svg', objurl: '/assets/obj/cws.obj' },
    DET: { elev: 600,  url: '/images/svg/det.svg', objurl: '/assets/obj/det.obj' },
    HOU: { elev: 45,   url: '/images/svg/hou.svg', objurl: '/assets/obj/hou.obj' },
    KCR: { elev: 865,  url: '/images/svg/kcr.svg', objurl: '/assets/obj/kcr.obj' },
    LAA: { elev: 151,  url: '/images/svg/laa.svg', objurl: '/assets/obj/laa.obj' },
    LAD: { elev: 515,  url: '/images/svg/lad.svg', objurl: '/assets/obj/lad.obj' },
    MIA: { elev: 10,   url: '/images/svg/mia.svg', objurl: '/assets/obj/mia.obj' },
    MIL: { elev: 597,  url: '/images/svg/mil.svg', objurl: '/assets/obj/mil.obj' },
    MIN: { elev: 815,  url: '/images/svg/min.svg', objurl: '/assets/obj/min.obj' },
    NYM: { elev: 10,   url: '/images/svg/nym.svg', objurl: '/assets/obj/nym.obj' },
    NYY: { elev: 55,   url: '/images/svg/nyy.svg', objurl: '/assets/obj/nyy.obj' },
    OAK: { elev: 3,    url: '/images/svg/oak.svg', objurl: '/assets/obj/oak.obj' },
    PHI: { elev: 20,   url: '/images/svg/phi.svg', objurl: '/assets/obj/phi.obj' },
    PIT: { elev: 780,  url: '/images/svg/pit.svg', objurl: '/assets/obj/pit.obj' },
    SDP: { elev: 23,   url: '/images/svg/sdp.svg', objurl: '/assets/obj/sdp.obj' },
    SEA: { elev: 10,   url: '/images/svg/sea.svg', objurl: '/assets/obj/sea.obj' },
    SFG: { elev: 0,    url: '/images/svg/sfg.svg', objurl: '/assets/obj/sfg.obj' },
    STL: { elev: 460,  url: '/images/svg/stl.svg', objurl: '/assets/obj/stl.obj' },
    TBR: { elev: 15,   url: '/images/svg/tbr.svg', objurl: '/assets/obj/tbr.obj' },
    TEX: { elev: 545,  url: '/images/svg/tex.svg', objurl: '/assets/obj/tex.obj' },
    TOR: { elev: 270,  url: '/images/svg/tor.svg', objurl: '/assets/obj/tor.obj' },
    WSH: { elev: 35,   url: '/images/svg/wsh.svg', objurl: '/assets/obj/wsh.obj' },
};

const startPosObject = new StartPosition(0, 2, 2.5);

const envObject = new EnvConditions(70, 21, 50, 0, 0);
const ballObject = new Ball(5.02623, 9.125);
const hitObject = new Hit(93, 25, -14, "L", true, 2615, 2541);

let trajObject = hitObject.calcTrajectory(envObject, ballObject, startPosObject);

let scene, controls;

let canvas, renderer, renderRequested, container, containerWidth;
let containerHeight, viewAspect, camera, camY, camZ, myFOV;

const MAX_POINTS = 3000;
let splashPoint, ring, meshLine, wallSphere;
let splashMaterial, ringMaterial, meshLineMeshMaterial, meshLineMesh, lineMaterial;
let sphereMaterial;

let windArrow, baseballIcon;
let ev_slider1, la_slider1, sd_slider1, temp_slider, wind_slider, wdir_slider, backspin_slider, sidespin_slider;
let input_ev1, input_la1, input_sd1, input_temp, input_wind, input_wdir, input_backspin, input_sidespin, radioLHB1, radioRHB1, radioSpin;
let uriParams, shareButton, copyButton, uri;
let elem1;
let baseballSpin = 0;

let wallObj, parkObj;
wallObj = null;

const raycaster = new THREE.Raycaster();
const raycaster2 = new THREE.Raycaster();
const raycaster3 = new THREE.Raycaster();
const raycaster4 = new THREE.Raycaster();

let notHomeRun = true;
let notFoulBall = true;
let initRenderCount = 0;


const nullVec3 = new THREE.Vector3(0,0,0);

const paramObject = {
    hitColor: '#e8f4f8',
    drawFillShapes: true,
    elevFt: 21,
    park: undefined,
    lastPark: undefined,
    currentURL: '/images/svg/bos.svg',
    objURL: '/assets/obj/bos.obj',
    edgeObjURL: '/assets/obj/bos_edge.obj',
};

const resultsObject = {
    distanceFt: "-",
    hangTime: 0,
    parkElev: 0,
    isHomeRun: false,
    catchDist: "-",
    seconds: "-",
    maxHeight: "-",
    angDeg: 0,
    isFoul: false,
    wallZFeet: 0,
    wallClearance: 0,
    timeToHomeRun: 0,
};

init();

function init() {
    if(window.innerWidth < 768 && window.visualViewport){
        document.body.style.height = window.visualViewport.height + 'px';
        document.getElementById("c").style.height = window.visualViewport.height * 0.85 + 'px';
    }

    scene = new THREE.Scene();

    getSaved();
    loadFirstOBJ();
    loadOBJfiles();
    parseURI();

    initButtons();

    paramObject.currentURL = parkObject[paramObject.park].url;
    envObject.elevFt = parkObject[paramObject.park].elev;
    paramObject.elevFt = envObject.elevFt;
    paramObject.elevFt = envObject.elevFt;
    paramObject.objURL = parkObject[paramObject.park].objurl;
    paramObject.edgeObjURL = parkObject[paramObject.park].edgeobjurl;

    initCamera();
    initLine();
    initControls();

    controls.update();
    controls.addEventListener('change', requestRenderIfNotRequested);
    window.addEventListener('resize', requestRenderIfNotRequested);
    createGUI();
    loadSVG(paramObject.park);
    // requestRenderIfNotRequested();
}

function loadOBJfiles() {
    for(var prop in parkObject) {
        parkObject[prop].object = loadAllOBJ(parkObject[prop].objurl);
    }
}

function loadFirstOBJ() {
    
    parkObject[paramObject.park].object = loadAllOBJ(parkObject[paramObject.park].objurl);
}

function updateHit() {

    drawHit();

    ev_slider1.value = hitObject.exitVelo;
    la_slider1.value = hitObject.launchAngle;
    sd_slider1.value = hitObject.sprayDir;
    temp_slider.value = envObject.tempF;
    wind_slider.value = envObject.vWind;
    wdir_slider.value = envObject.phiWind;
    backspin_slider.value = hitObject.backspin;
    sidespin_slider.value = hitObject.sidespin;
}

function initButtons() {

    windArrow = document.getElementById("wind-arrow");
    baseballIcon = document.getElementsByClassName("baseball-icon")[0];

    shareButton = document.getElementById("share-button");
    shareButton.addEventListener("click", encodeHitURI);

    copyButton = document.getElementById("copy-btn");
    copyButton.addEventListener("click", toClipboard);

    elem1 = document.createElement('div');

    elem1.style.display = 'block';
    elem1.className = "pin2 h4 text-center";
    elem1.id = "distance_label";
    elem1.style.zIndex = 8;
    document.getElementById("canvas_container").insertBefore(elem1, document.getElementById("c"));

    ev_slider1 = document.getElementById("ev_slider1");
    la_slider1 = document.getElementById("la_slider1");
    sd_slider1 = document.getElementById("sd_slider1");
    temp_slider = document.getElementById("temp_slider");
    wind_slider = document.getElementById("wind_slider");
    wdir_slider = document.getElementById("wdir_slider");
    backspin_slider = document.getElementById("backspin_slider");
    sidespin_slider = document.getElementById("sidespin_slider");

    input_ev1 = document.getElementById("ev_input1");
    input_la1 = document.getElementById("la_input1");
    input_sd1 = document.getElementById("sd_input1");
    input_temp = document.getElementById("temp_input");
    input_wind = document.getElementById("wind_input");
    input_wdir = document.getElementById("wdir_input");
    input_backspin = document.getElementById("backspin_input");
    input_sidespin = document.getElementById("sidespin_input");

    document.addEventListener('focusout', function (event) {
        if (document.querySelectorAll("input[type='number']")) {
            if (event.defaultPrevented) {
                return; // Do nothing if the event was already processed
            }
            enterDetails();
        }
        event.preventDefault();
    }, false);

    document.addEventListener('keyup', function (event) {
        if (document.querySelectorAll("input[type='number']")) {
            if (event.defaultPrevented) {
                return; // Do nothing if the event was already processed
            }
            switch (event.key) {
                case "Enter":
                    enterDetails();
            }
            event.preventDefault();
        }
    }, false);

    input_ev1.addEventListener("focus", focusEventHandler.bind(null, input_ev1));
    input_la1.addEventListener("focus", focusEventHandler.bind(null, input_la1));
    input_sd1.addEventListener("focus", focusEventHandler.bind(null, input_sd1));
    input_temp.addEventListener("focus", focusEventHandler.bind(null, input_temp));
    input_wind.addEventListener("focus", focusEventHandler.bind(null, input_wind));
    input_wdir.addEventListener("focus", focusEventHandler.bind(null, input_wdir));
    input_backspin.addEventListener("focus", focusEventHandler.bind(null, input_backspin));
    input_sidespin.addEventListener("focus", focusEventHandler.bind(null, input_sidespin));

    input_ev1.addEventListener("blur", blurEventHandler.bind(null, input_ev1));
    input_la1.addEventListener("blur", blurEventHandler.bind(null, input_la1));
    input_sd1.addEventListener("blur", blurEventHandler.bind(null, input_sd1));
    input_temp.addEventListener("blur", blurEventHandler.bind(null, input_temp));
    input_wind.addEventListener("blur", blurEventHandler.bind(null, input_wind));
    input_wdir.addEventListener("blur", blurEventHandler.bind(null, input_wdir));
    input_backspin.addEventListener("blur", blurEventHandler.bind(null, input_backspin));
    input_sidespin.addEventListener("blur", blurEventHandler.bind(null, input_sidespin));

    radioLHB1 = document.getElementById("LHB_radio1");

    radioLHB1.onclick = function () {
        hitObject.hand = radioLHB1.value;
        updateHit();
    }

    radioRHB1 = document.getElementById("RHB_radio1");
    radioRHB1.onclick = function () {
        hitObject.hand = radioRHB1.value;
        updateHit();
    }

    if (hitObject.hand == "L") {
        radioRHB1.checked = false;
        radioLHB1.checked = true;
    };

    if (hitObject.hand == "R") {
        radioRHB1.checked = true;
        radioLHB1.checked = false;
    };

    radioSpin = document.getElementById("estimate_spin_check");
    radioSpin.checked = hitObject.estimateSpin;
    backspin_slider.disabled = hitObject.estimateSpin;
    sidespin_slider.disabled = hitObject.estimateSpin;
    input_backspin.disabled = hitObject.estimateSpin;
    input_sidespin.disabled = hitObject.estimateSpin;

    radioSpin.onclick = function () {
        hitObject.estimateSpin = !hitObject.estimateSpin;
        updateHit();

        if (radioSpin.checked == true) {
            backspin_slider.disabled = true;
            sidespin_slider.disabled = true;
            input_backspin.disabled = true;
            input_sidespin.disabled = true;
        }
        if (radioSpin.checked == false) {
            backspin_slider.disabled = false;
            sidespin_slider.disabled = false;
            input_backspin.disabled = false;
            input_sidespin.disabled = false;
        }
    }
    input_ev1.value = hitObject.exitVelo.toFixed(1);
    input_la1.value = hitObject.launchAngle.toFixed(1);
    input_sd1.value = hitObject.sprayDir.toFixed(1);
    input_temp.value = envObject.tempF.toFixed(0);
    input_wind.value = envObject.vWind.toFixed(0);
    input_wdir.value = envObject.phiWind.toFixed(0);

    const selectElement = document.getElementById('select');
    selectElement.value = paramObject.park;

    selectElement.addEventListener('change', (event) => {
        paramObject.currentURL = parkObject[event.target.value].url;
        paramObject.objURL = parkObject[event.target.value].objurl;
        paramObject.edgeObjURL = parkObject[event.target.value].edgeobjurl;
        envObject.elevFt = parkObject[event.target.value].elev;
        paramObject.elevFt = envObject.elevFt;
        paramObject.lastPark = paramObject.park;
        paramObject.park = event.target.value;
        loadSVG(paramObject.park);
        localStorage.setItem("savedPark", paramObject.park)
    });
}

function encodeHitURI() {
    uri = "https://www.baseballflightsim.com/"
        + `?ev=${encodeURIComponent(hitObject.exitVelo)}`
        + `&la=${encodeURIComponent(hitObject.launchAngle)}`
        + `&sd=${encodeURIComponent(hitObject.sprayDir)}`
        + `&hand=${encodeURIComponent(hitObject.hand)}`
        + `&est_spin=${encodeURIComponent(hitObject.estimateSpin)}`
        + `&bspin=${encodeURIComponent(hitObject.backspin)}`
        + `&sspin=${encodeURIComponent(hitObject.sidespin)}`
        + `&temp=${encodeURIComponent(envObject.tempF)}`
        + `&wind_v=${encodeURIComponent(envObject.vWind)}`
        + `&wind_dir=${encodeURIComponent(envObject.phiWind)}`
        + `&park=${encodeURIComponent(paramObject.park)}`;

    document.getElementById("share-link").value = uri;
}

function createGUI() {

    backspin_slider.value = hitObject.backspin;
    sidespin_slider.value = hitObject.sidespin;
    input_backspin.value = hitObject.backspin;
    input_sidespin.value = hitObject.sidespin;
    windArrow.style.transform = `rotateZ(${envObject.phiwind}deg)`;

    ev_slider1.value = hitObject.exitVelo;
    la_slider1.value = hitObject.launchAngle;
    sd_slider1.value = hitObject.sprayDir;
    temp_slider.value = envObject.tempF;
    wind_slider.value = envObject.vWind;
    wdir_slider.value = envObject.phiWind;

    ev_slider1.addEventListener('input', sliderHandler1);
    la_slider1.addEventListener('input', sliderHandler2);
    sd_slider1.addEventListener('input', sliderHandler3);
    temp_slider.addEventListener('input', sliderHandler4);
    wind_slider.addEventListener('input', sliderHandler5);
    wdir_slider.addEventListener('input', sliderHandler6);
    backspin_slider.addEventListener('input', sliderHandler7);
    sidespin_slider.addEventListener('input', sliderHandler8);

}

function drawHit() {

    resultsObject.isHomeRun = false;
    resultsObject.isFoul = false;
    resultsObject.wallZFeet = 0;
    resultsObject.wallClearance = 0;

    ring.visible = true;
    splashPoint.visible = true;
    wallSphere.visible = false;

    trajObject = hitObject.calcTrajectory(envObject, ballObject, startPosObject);
    const endX = trajObject.positions[trajObject.positions.length - 3];
    const endY = trajObject.positions[trajObject.positions.length - 2];

    const endXFeet = endX * 2.4;
    const endYFeet = endY * 2.4;

    let ringGeo = new THREE.RingGeometry(trajObject.splashRadiusCoord - 1, trajObject.splashRadiusCoord, 64);

    ring.geometry.vertices = ringGeo.vertices;
    ring.geometry.verticesNeedUpdate = true;
    ring.geometry.elementsNeedUpdate = true;

    ring.position.x = endX;
    ring.position.y = endY;


    splashPoint.position.x = endX;
    splashPoint.position.y = endY;

    resultsObject.distanceFt = round(trajObject.distFeet, 0).toFixed(0);
    resultsObject.hangTime = round(trajObject.hangTime, 1).toFixed(1);
    resultsObject.catchDist = Math.round(trajObject.splashRadius);
    resultsObject.parkElev = 'Park Elevation: ' + envObject.elevFt + ' ft';
    resultsObject.maxHeight = round(trajObject.hitApex, 0).toFixed(0);

    raycastHit();
    
}

function raycastHit() {

    const endX = ring.position.x;
    const endY = ring.position.y;

    const rayDirection = new THREE.Vector3(0, 0, -1);
    rayDirection.normalize();
    const vec = new THREE.Vector3( endX, endY, 0.5 );

    raycaster.set(vec, rayDirection)

    const intersects = raycaster.intersectObjects( parkObj.children );

    if ( intersects.length == 0 ) {
        calcWallIntersection(parkObj);
        return;
    } else {
        meshLine.setPoints(trajObject.positions);
        requestRenderIfNotRequested();
    }
    let angDeg = calcAngleDegrees(endX, endY, trajObject.xStart, trajObject.yStart);

    if ( intersects.length > 0 && (angDeg < -45 || angDeg > 45)) {
        resultsObject.isFoul = true;
    }
    raycaster.set(nullVec3, nullVec3)
}

function calcWallIntersection() {
    ring.visible = false;
    wallSphere.visible = true;
    resultsObject.isHomeRun = false;

    const endX = ring.position.x;
    const endY = ring.position.y;

    let rayPosX;
    let rayPosY;
    const rayPosZ = 1;
    const rayDirectionDown = new THREE.Vector3(0, 0, -1);
    rayDirectionDown.normalize();
    let newVec = new THREE.Vector3(endX, endY, rayPosZ);
    let newIntersects = [];
    let wallIntersect;
    let newPositions;
    let wallZ;
    let wallBallX;
    let wallBallY;
    let i = trajObject.positions.length / 3;
    let face = null;

    let xIdx, yIdx, zIdx;

    while (newIntersects.length == 0 && i > 1) {
        xIdx = i * 3 - 3;
        yIdx = i * 3 - 2;
        zIdx = i * 3 - 1;
        rayPosX = trajObject.positions[xIdx];
        rayPosY = trajObject.positions[yIdx];
        newVec.set(rayPosX, rayPosY, rayPosZ);
        raycaster2.set(newVec, rayDirectionDown);
        newIntersects = raycaster2.intersectObjects( parkObj.children, true );
        i--;
    }
    if (newIntersects.length) {
        wallIntersect = newIntersects[0].point;
        wallZ = trajObject.positions[zIdx];
        let posArrayLength = i * 3 + 3;
        newPositions = trajObject.positions.slice(0, posArrayLength);
        wallBallX = wallIntersect.x;
        wallBallY = wallIntersect.y;
    }

    let dirX, dirY, dirZ;
    dirX = trajObject.positions[xIdx] - trajObject.positions[xIdx - 3];
    dirY = trajObject.positions[yIdx] - trajObject.positions[yIdx - 3];
    dirZ = trajObject.positions[zIdx] - trajObject.positions[zIdx - 3];
    const rayDirection3 = new THREE.Vector3(dirX, dirY, dirZ);
    const rayOrigin3 = new THREE.Vector3(trajObject.positions[xIdx - 6], trajObject.positions[yIdx - 6], trajObject.positions[zIdx -6]);
    rayDirection3.normalize();

    raycaster3.set(rayOrigin3, rayDirection3);
    raycaster3.far = 5;

    let wallRayIntersects = raycaster3.intersectObject( wallObj );
    
    if (wallRayIntersects.length) {
        face = wallRayIntersects[0].face;
        meshLine.setPoints(newPositions);
        calcWallIntersectionHeight(newPositions, wallBallX, wallBallY, wallZ)
        return;
    } else {
        calcIsHomeRun(wallBallX, wallBallY, wallRayIntersects)
            // return;
        // if (typeof wallRayIntersects[0] === undefined) {
        //     return;
        // }
    }
    raycaster2.set(nullVec3, nullVec3)

}

function removeArrow() {
    let children_to_remove = [];
    scene.traverse(function (child) {
        if (child.name == "arrow" ) {
            children_to_remove.push(child);
        }
    });

    children_to_remove.forEach(function (child) {
        scene.remove(child);
    });
}

function calcIsHomeRun(wallX, wallY, rayIntersections) {
    ring.visible = false;
    wallSphere.visible = false;
    resultsObject.catchDist = "n/a";
    // removeArrow();
    meshLine.setPoints(trajObject.positions);
    requestRenderIfNotRequested();
    let angDeg = calcAngleDegrees(wallX, wallY, trajObject.xStart, trajObject.yStart);
    if (angDeg < -45 || angDeg > 45) {
        isFoulBall();
    } else {
        if (!wallObj && rayIntersections[0] === undefined) {
            resultsObject.isHomeRun = false;
            return;
        }
        if (rayIntersections[0] === undefined) {
            resultsObject.isHomeRun = true;
        }
    }
}

function isFoulBall() {
    resultsObject.isFoul = true;
    resultsObject.isHomeRun = false;
    if (ring.visible === false) {
        resultsObject.catchDist = "n/a";
    }
    requestRenderIfNotRequested();
}

function calcWallIntersectionHeight(pos, wallX, wallY, wallZ) {
    wallSphere.position.x = wallX;
    wallSphere.position.y = wallY;
    wallSphere.position.z = wallZ;
    let ft_at_wall = wallZ * 2.4;
    resultsObject.wallZFeet = round(ft_at_wall, 1);
    if (resultsObject.isHomeRun === false) {
        wallSphere.visible = true;
        meshLine.setPoints(pos);
    }
    if(ft_at_wall < 8) {
        const splashRad = trajObject.splashRadiusCoord * (1 - ft_at_wall / 20);
        let ringGeo = new THREE.RingGeometry(splashRad - 1, splashRad, 64);
        resultsObject.catchDist = round(splashRad * 2.4, 0);

        ring.geometry.vertices = ringGeo.vertices;
        ring.geometry.verticesNeedUpdate = true;
        ring.geometry.elementsNeedUpdate = true;

        ring.visible = true;
    } else {
        resultsObject.catchDist = "n/a";
        ring.visible = false;
    }
    requestRenderIfNotRequested();
}

function initCamera() {
    canvas = document.querySelector('#c');
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.sortObjects = false;
    renderRequested = { request: false };
    container = document.querySelector('#canvas_container');
    containerWidth = container.offsetWidth;
    containerHeight = container.offsetHeight;
    viewAspect = containerWidth / containerWidth;
    camera = new THREE.PerspectiveCamera(myFOV, (canvas.clientWidth) / (canvas.clientHeight), 1, 1000);
    camY = -250;
    camZ = -camY / 3.3;
    camera.position.set(0, camY, camZ);
    camera.up = new THREE.Vector3(0, 0, 1);
    renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
}

function initControls() {
    controls = new OrbitControls(camera, canvas);
    controls.enablePan = true;
    controls.minPolarAngle = -Math.PI;
    controls.enableRotate = true;
    controls.enableDamping = true;
    controls.dampingFactor = 0.2;
    controls.maxPolarAngle = Math.PI / 2 - 0.02;
    controls.minDistance = 12;
    controls.screenSpacePanning = false;
    controls.keys = {
        LEFT: 'ArrowLeft', //left arrow
        UP: 'ArrowUp', // up arrow
        RIGHT: 'ArrowRight', // right arrow
        BOTTOM: 'ArrowDown' // down arrow
    }
    controls.keyPanSpeed = 10;
    controls.target.set(0, -30, 2);
}

function loadSVG(park) {
    wallObj = null;
    const url = parkObject[park].url;
    const loader = new SVGLoader();
    loader.load(url, function (data) {
        let children_to_remove = [];
        scene.traverse(function (child) {
            if (child.name == "park" ) {
                children_to_remove.push(child);
            }
            if (child.name == "wall" ) {
                children_to_remove.push(child);
            }
        });
    
        children_to_remove.forEach(function (child) {
            scene.remove(child);
        });

        const paths = data.paths;
        const group = new THREE.Group();
        group.name = 'park';
        group.scale.x *= 1;
        group.scale.y *= 1;
        group.scale.z *= 1;

        for (let i = 0; i < paths.length; i++) {

            const path = paths[i];
            path.name = path.userData.node.id;

            let fillColor = path.userData.style.fill;

            // Green Dark Mode
            if (fillColor === "rgb(178, 223, 219)") {
                fillColor = ("#067D3E");
            }

            // White to tan Dark Mode
            if (fillColor === "rgb(255, 255, 255)") {
                fillColor = ("#cea37a");
            }

            // Grey to white Dark Mode
            if (fillColor === "rgb(194, 194, 194)") {
                fillColor = ("#ffffff");
            }

            if (paramObject.drawFillShapes && fillColor !== undefined && fillColor !== 'none') {

                const material = new THREE.MeshBasicMaterial({
                    color: new THREE.Color().setStyle(fillColor),
                    opacity: path.userData.style.fillOpacity,
                    transparent: path.userData.style.fillOpacity < 1,
                    side: THREE.DoubleSide,
                    depthWrite: false
                });

                const shapes = path.toShapes(false, false);

                for (let j = 0; j < shapes.length; j++) {
                    const shape = shapes[j];
                    const geometry = new THREE.ShapeBufferGeometry(shape);
                    geometry.applyMatrix4(new THREE.Matrix4().makeScale ( 1, -1, 1 ))
                    const mesh = new THREE.Mesh(geometry, material);
                    mesh.name = path.userData.node.id;
                    group.add(mesh);
                }
            }

            let strokeColor = path.userData.style.stroke;

            // White to Tan
            if (strokeColor === "rgb(255, 255, 255)") {
                strokeColor = ("#cea37a");
            }

            if (strokeColor !== undefined && strokeColor !== 'none') {

                const material = new THREE.MeshBasicMaterial({
                    color: new THREE.Color().setStyle(strokeColor),
                    opacity: path.userData.style.strokeOpacity,
                    transparent: path.userData.style.strokeOpacity < 1,
                    side: THREE.DoubleSide,
                    depthWrite: false,
                });

                for (let j = 0, jl = path.subPaths.length; j < jl; j++) {

                    const subPath = path.subPaths[j];
                    const geometry = SVGLoader.pointsToStroke(subPath.getPoints(), path.userData.style);
                    // applying scale to invert y-axis. Otherwise, SVGs are loaded upside-down/backwards
                    geometry.applyMatrix4(new THREE.Matrix4().makeScale ( 1, -1, 1 ))
                    if (geometry) {
                        const mesh = new THREE.Mesh(geometry, material);
                        mesh.name = paths[i].userData.node.id;
                        group.add(mesh);
                    }
                }
            }
        }
        scene.add(group);
        parkObj = null;
        parkObj = group;

        loadOBJ(paramObject.park);

        requestRenderIfNotRequested();
    },

    function ( xhr ) {
    },
    function ( loadend ) {
    },
    );

    document.getElementById("park_elevation").innerHTML = envObject.elevFt + " ft";
}


function loadOBJ(park) {
    scene.add(parkObject[park].object);

    wallObj = parkObject[park].object;
    
    requestRenderIfNotRequested();
    updateHit();

    initRenderCount = 0;
    for (let i = 1; i <= 30; i++) {
        setDelay(i);
        initRenderCount = initRenderCount++;
      }
    function setDelay(i) {
      setTimeout(function(){
       updateHit();
      }, 60);
    }
}

function loadAllOBJ(url) {

    const objectLoader = new OBJLoader();
    const wallMaterial = new THREE.MeshBasicMaterial ({ side: THREE.DoubleSide, color: "#04572B", wireframe: false });
    const geo = new THREE.BufferGeometry();
    const mesh = new THREE.Mesh( geo, wallMaterial );

    objectLoader.load(url, function(object) {
        object.children[0].material = wallMaterial;
        object.children[0].scale.y *= -1;
        geo.attributes = object.children[0].geometry;
        mesh.geometry = object.children[0].geometry;
        mesh.geometry.vertices = object.children[0].geometry.vertices;
        mesh.scale.y *= -1;
        mesh.position.x = - 125;
        mesh.position.y = 125;
        mesh.geometry.verticesNeedUpdate = true;
        mesh.geometry.elementsNeedUpdate = true;
        mesh.name = "wall";
    },

    function ( xhr ) {
    },
    
    function ( loadend ) {        
        
    },
    );
    return(mesh);
}

function initLine() {
    // geometry
    const meshLineGeo = new THREE.BufferGeometry();
    const splashGeo = new THREE.RingGeometry(0, 2, 32);
    const ringGeo = new THREE.RingGeometry(8, 10, 64);
    const sphereGeo = new THREE.SphereGeometry( 1, 16, 16 );
    // attributes
    const positions = new Float32Array(MAX_POINTS * 3).fill(0); // 3 vertices per point
    meshLineGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    splashMaterial = new THREE.MeshBasicMaterial({
        color: paramObject.hitColor,
        opacity: 0.4,
        transparent: true,
    });

    ringMaterial = new THREE.MeshBasicMaterial({
        color: paramObject.hitColor,
        opacity: 0.4,
        transparent: true,
    });

    sphereMaterial = new THREE.MeshBasicMaterial({
        // color: paramObject.hitColor,
        color: '#FFF880',
        opacity: 0.8,
        transparent: true,
    });

    splashPoint = new THREE.Mesh(splashGeo, splashMaterial);
    splashPoint.name = 'splashPoint';

    ring = new THREE.Mesh(ringGeo, splashMaterial);
    ring.name = 'ring';

    wallSphere = new THREE.Mesh( sphereGeo, sphereMaterial );
    wallSphere.name = "wall_sphere";
    wallSphere.visible = true;
    wallSphere.position.y = - 78.4

    splashPoint.position.x = 0;
    splashPoint.position.z = 0;
    splashPoint.position.y = - 78.4;

    ring.position.y = - 78.4;
    ring.position.z = 0;

    meshLine = new MeshLine();
    meshLine.setPoints(positions);
    

    meshLineMeshMaterial = new MeshLineMaterial({
        color: paramObject.hitColor,
        resolution: new THREE.Vector2(canvas.clientWidth, canvas.clientHeight),
        transparent: true,
        opacity: 0.7,
    });

    lineMaterial = new THREE.LineBasicMaterial( { color: paramObject.hitColor } );

    meshLineMesh = new THREE.Mesh(meshLine);
    meshLineMesh.material = meshLineMeshMaterial;

    meshLineMesh.position.y = 0;
    meshLineMesh.scale.x = 1;
    meshLineMesh.scale.y = 1;
    meshLineMesh.scale.z = 1;

    meshLineMesh.name = 'Mesh-Line';

    splashPoint.visible = false;
    ring.visible = false;
    meshLineMesh.visible = true;
    wallSphere.visible = false;

    scene.add(meshLineMesh);
    scene.add(splashPoint);
    scene.add(ring);
    scene.add(wallSphere);
}

function resizeRendererToDisplaySize(renderer) {
    const canvas2 = renderer.domElement;
    const width = canvas2.clientWidth;
    const height = canvas2.clientHeight;
    const needResize = canvas.width !== width || canvas.height !== height;
    if (needResize) {
        renderer.setSize(width, height, false);
    }
    return needResize;
}

function requestRenderIfNotRequested() {
    if (!renderRequested.request) {
        requestAnimationFrame(render);
        renderRequested.request = true;
    }
}

function render() {
    renderRequested.request = undefined;
    if (resizeRendererToDisplaySize(renderer)) {
        const canvas = renderer.domElement;
        camera.aspect = canvas.clientWidth / canvas.clientHeight;
        camera.updateProjectionMatrix();
    }

    const landingSpot = new THREE.Vector3();

    splashPoint.updateWorldMatrix(true, false);
    splashPoint.getWorldPosition(landingSpot);
    landingSpot.project(camera);

    const lineProjection = new THREE.Vector3();

    meshLineMesh.getWorldPosition(lineProjection);
    lineProjection.project(camera);

    document.getElementById("hang_time1").innerHTML = resultsObject.hangTime + " s";
    document.getElementById("hit_distance").innerHTML = resultsObject.distanceFt + " ft";

    if (resultsObject.catchDist == "n/a") {
        document.getElementById("catch_dist1").innerHTML = resultsObject.catchDist;
    } else document.getElementById("catch_dist1").innerHTML = resultsObject.catchDist + " ft";

    const x = (landingSpot.x * 0.5 - .5) * canvas.clientWidth;

    const y = (landingSpot.y * -.5 + .5) * canvas.clientHeight;

    if (resultsObject.isHomeRun === true) {
        if (notHomeRun === true) {
            document.getElementById("home_run_tag").style.color = '#FFF880';
            document.getElementById("home_run_tag").style.opacity = '1';
            document.querySelector('.logo').src = "/images/icons/logo-yellow.svg";
        }
        notHomeRun = false;
    } else {
        if (notHomeRun === false) {
            document.getElementById("home_run_tag").style.color = 'unset';
            document.getElementById("home_run_tag").style.opacity = '0.5';
            document.querySelector('.logo').src = "/images/icons/logo-bg-dark.svg";
        }
        notHomeRun = true;
    }
    if (resultsObject.isFoul === true) {
        if (notFoulBall === true) {
            document.getElementById("foul_ball_tag").style.color = '#FFF880';
            document.getElementById("foul_ball_tag").style.opacity = 'unset';
        }
        notFoulBall = false;
    } else {
        if (notFoulBall === false) {
            document.getElementById("foul_ball_tag").style.color = '#f8f9fa';
            document.getElementById("foul_ball_tag").style.opacity = '50%';
        }
        notFoulBall = true;
    }

    controls.update();
    renderer.render( scene, camera );
    renderer.renderLists.dispose();
}

/* 
*******  Event Listeners, Handlers, helper functions ****************
*/

function getSaved() {
    if (localStorage.getItem("savedPark")) {
        paramObject.park = localStorage.getItem("savedPark");

    } else {
        paramObject.park = "BOS";
    }
}

function parseURI() {

    const uriString = window.location.search;

    if (uriString) {

        const url = new URL("http://www.baseballflighsim.com/" + uriString);

        uriParams = {
            exit: Number(url.searchParams.get('ev')),
            launch: Number(url.searchParams.get('la')),
            spray: Number(url.searchParams.get('sd')),
            hand: url.searchParams.get('hand'),
            estimateSpin: url.searchParams.get('est_spin') == "true",
            backspin: Number(url.searchParams.get('bspin')),
            sidespin: Number(url.searchParams.get('sspin')),
            temp_f: Number(url.searchParams.get('temp')),
            vwind: Number(url.searchParams.get('wind_v')),
            phiwind: Number(url.searchParams.get('wind_dir')),
            park: url.searchParams.get('park')
        }

        if (url.searchParams.has('ev')) hitObject.exitVelo = uriParams.exit;
        if (url.searchParams.has('la')) hitObject.launchAngle = uriParams.launch;
        if (url.searchParams.has('sd')) hitObject.sprayDir = uriParams.spray;
        if (url.searchParams.has('hand')) hitObject.hand = uriParams.hand.toUpperCase();
        if (url.searchParams.has('est_spin')) hitObject.estimateSpin = uriParams.estimateSpin;
        if (url.searchParams.has('bspin')) hitObject.backspin = uriParams.backspin;
        if (url.searchParams.has('sspin')) hitObject.sidespin = uriParams.sidespin;
        if (url.searchParams.has('temp')) envObject.tempF = uriParams.temp_f;
        if (url.searchParams.has('wind_v')) envObject.vWind = uriParams.vwind;
        if (url.searchParams.has('wind_dir')) envObject.phiWind = uriParams.phiwind;
        if (url.searchParams.has('park')) paramObject.park = uriParams.park.toUpperCase();
    }
}

function toClipboard() {
    navigator.clipboard.writeText(uri);
}

function calcAngleDegrees(x_end, y_end, x_start, y_start) {
    return Math.atan2(x_end - x_start, y_end - y_start)* 180 / Math.PI;
}

function round(value, precision) {
    const multiplier = Math.pow(10, precision || 0);
    return Math.round(value * multiplier) / multiplier;
}

function enterDetails() {
    let exit_value, launch_value, spray_value, temp_value, wind_value, wdir_value, backspin_value, sidespin_value;

    exit_value = document.getElementById("ev_input1").value;
    launch_value = document.getElementById("la_input1").value;
    spray_value = document.getElementById("sd_input1").value;
    temp_value = document.getElementById("temp_input").value;
    wind_value = document.getElementById("wind_input").value;
    wdir_value = document.getElementById("wdir_input").value;
    backspin_value = document.getElementById("backspin_input").value;
    sidespin_value = document.getElementById("sidespin_input").value;

    if (hitObject.exit != exit_value || hitObject.launch != launch_value || 
        hitObject.sprayDir != spray_value || envObject.tempF != temp_value || 
        envObject.vwind != wind_value || envObject.phiwind != wdir_value || 
        hitObject.backspin != backspin_value || hitObject.sidespin != sidespin_value) {
        if (exit_value < 0) {
            exit_value = 0;
            input_ev1.value = exit_value.toFixed(1);
        }
        hitObject.exitVelo = exit_value;
        hitObject.launchAngle = launch_value;
        hitObject.sprayDir = spray_value;
        envObject.tempF = temp_value;
        envObject.vWind = wind_value;
        envObject.phiWind = wdir_value;
        hitObject.backspin = backspin_value;
        hitObject.sidespin = sidespin_value;
        if(envObject.phiwind != wdir_value){
            windArrow.style.transform = `rotateZ(${envObject.phiwind}deg)`;
        }

        updateHit();
    }
}

function focusEventHandler(item) {
    item.initialValue = item.value || '';
    item.value == item.initialValue ? item.value = "" : "";
}

function blurEventHandler(item) {
    item.value == "" ? item.value = item.initialValue : "";
}

// Functions to update hit parameters after pressing "Enter"
function enterKey(e) {
    if (e.defaultPrevented) {
        return; // Do nothing if the event was already processed
    }
    switch (e.key) {
        case "Enter":
            enterDetails();

    }
    e.preventDefault();
}

function sliderHandler1() {
    hitObject.exitVelo = Number(ev_slider1.value);
    input_ev1.value = hitObject.exitVelo.toFixed(1);
    updateHit();
}

function sliderHandler2() {
    hitObject.launchAngle = Number(la_slider1.value);
    input_la1.value = hitObject.launchAngle.toFixed(1);
    updateHit();
}

function sliderHandler3() {
    hitObject.sprayDir = Number(sd_slider1.value);
    input_sd1.value = hitObject.sprayDir.toFixed(1);
    baseballSpin = baseballSpin - 0.06 * (hitObject.sidespin / 8500);
    baseballIcon.style.transform = `scale3d(2, 1, 1) rotateZ(${baseballSpin}turn)`;
    updateHit();
}

function sliderHandler4() {
    envObject.tempF = Number(temp_slider.value);
    input_temp.value = envObject.tempF.toFixed(0);
    updateHit();
}

function sliderHandler5() {
    envObject.vWind = Number(wind_slider.value);
    input_wind.value = envObject.vWind.toFixed(0);
    updateHit();
}

function sliderHandler6() {
    envObject.phiWind = Number(wdir_slider.value);
    input_wdir.value = envObject.phiWind.toFixed(0);
    windArrow.style.transform = `rotateZ(${envObject.phiWind}deg)`;
    updateHit();
}

function sliderHandler7() {
    hitObject.backspin = Number(backspin_slider.value);
    input_backspin.value = hitObject.backspin.toFixed(0);
    updateHit();
}

function sliderHandler8() {
    hitObject.sidespin = Number(sidespin_slider.value);
    input_sidespin.value = hitObject.sidespin.toFixed(0);
    baseballSpin = baseballSpin - 0.08 * (hitObject.sidespin / 2500);
    baseballIcon.style.transform = `scale3d(2, 1, 1) rotateZ(${baseballSpin}turn)`;
    updateHit();
}
