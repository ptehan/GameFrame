"""Baseball Flight Sim compatible trajectory generation.

This module is a Python port of the public Baseball Flight Simulator
``hit_class_module.js`` trajectory logic. It intentionally keeps the same
feet/seconds/mph/rpm boundary units used by that calculator so generated
synthetic data can be checked against Baseball Flight Sim before being
converted into SI units for inference internals.
"""

from __future__ import annotations

from dataclasses import dataclass
from bisect import bisect_right
from flight_integrator import integrate_flight
import math


@dataclass(frozen=True)
class Ball:
    mass_oz: float = 5.02623
    circumference_in: float = 9.125


@dataclass(frozen=True)
class Environment:
    temp_f: float = 70.0
    elevation_ft: float = 21.0
    relative_humidity_pct: float = 50.0
    wind_mph: float = 0.0
    wind_direction_deg: float = 0.0


@dataclass(frozen=True)
class StartPosition:
    x_ft: float = 0.0
    y_ft: float = 2.0
    z_ft: float = 2.5


@dataclass(frozen=True)
class Hit:
    exit_velocity_mph: float
    launch_angle_deg: float
    spray_angle_deg: float
    batter_hand: str = "R"
    estimate_spin: bool = True
    backspin_rpm: float = 0.0
    sidespin_rpm: float = 0.0


@dataclass(frozen=True)
class TrajectoryPoint:
    t_s: float
    x_ft: float
    y_ft: float
    z_ft: float
    vx_ft_s: float
    vy_ft_s: float
    vz_ft_s: float
    speed_ft_s: float
    distance_ft: float
    height_ft: float


@dataclass(frozen=True)
class Trajectory:
    points: list[TrajectoryPoint]
    distance_ft: float
    hang_time_s: float
    apex_ft: float
    apex_time_s: float
    landing_x_ft: float
    landing_y_ft: float
    landing_spray_angle_deg: float
    bfs_display_angle_deg: float
    backspin_rpm: float
    sidespin_rpm: float
    spin_rpm: float


def estimate_spin(launch_angle_deg: float, spray_angle_deg: float, batter_hand: str) -> tuple[float, float]:
    """Baseball Flight Sim/Nathan default spin estimate.

    ``batter_hand`` is ``"L"`` or ``"R"``. Positive/negative spray follows the
    Baseball Flight Sim convention.
    """

    sign = -1 if batter_hand.upper() == "L" else 1
    backspin = -763 + (120 * launch_angle_deg) + (21 * spray_angle_deg * sign)
    sidespin = -sign * 849 - 94 * spray_angle_deg
    return backspin, sidespin


def calc_angle_degrees(x_end: float, y_end: float) -> float:
    # Baseball Flight Sim uses 90 / pi rather than 180 / pi.
    return math.atan2(x_end, y_end) * (90 / math.pi)


def simulate_trajectory(
    hit: Hit,
    env: Environment = Environment(),
    ball: Ball = Ball(),
    start: StartPosition = StartPosition(),
    dt_s: float = 0.01,
    sample_times=None,
    _position_buffer=None,
) -> Trajectory:
    """Simulate a batted ball using the Baseball Flight Sim equations."""

    hand = hit.batter_hand.upper()
    sign = -1 if hand == "L" else 1

    exit_velocity = max(hit.exit_velocity_mph, 0.01)
    phi = hit.spray_angle_deg
    launch_angle = hit.launch_angle_deg

    if hit.estimate_spin:
        backspin, sidespin = estimate_spin(launch_angle, phi, hand)
    else:
        backspin, sidespin = hit.backspin_rpm, hit.sidespin_rpm
    if sidespin == 0:
        sidespin = 0.1

    temp_c = (5 / 9) * (env.temp_f - 32)
    elev_m = env.elevation_ft / 3.2808
    pressure_hg = 29.92
    pressure = pressure_hg * 1000 / 39.37
    beta = 0.0001217
    svp = 4.5841 * math.exp((18.687 - temp_c / 234.5) * temp_c / (257.14 + temp_c))
    rho_kg_m3 = 1.2929 * (
        273
        / (temp_c + 273)
        * (pressure * math.exp(-beta * elev_m) - 0.3783 * env.relative_humidity_pct * svp / 100)
        / 760
    )
    rho_lb_ft3 = rho_kg_m3 * 0.06261

    k = 0.07182 * rho_lb_ft3 * (5.125 / ball.mass_oz) * (ball.circumference_in / 9.125) ** 2

    g = 32.174
    tau = 10000
    spin = math.hypot(backspin, sidespin)
    v0 = exit_velocity * 1.467
    la_rad = math.radians(launch_angle)
    phi_rad = math.radians(phi)

    vxw = env.wind_mph * 1.467 * math.sin(math.radians(env.wind_direction_deg))
    vyw = env.wind_mph * 1.467 * math.cos(math.radians(env.wind_direction_deg))

    vx0 = v0 * math.cos(la_rad) * math.sin(phi_rad)
    vy0 = v0 * math.cos(la_rad) * math.cos(phi_rad)
    vz0 = v0 * math.sin(la_rad)

    wx = (backspin * math.cos(phi_rad) - sidespin * math.sin(la_rad) * math.sin(phi_rad)) * math.pi / 30
    wy = (-backspin * math.sin(phi_rad) - sidespin * math.sin(la_rad) * math.cos(phi_rad)) * math.pi / 30
    wz = sidespin * math.cos(la_rad) * math.pi / 30
    omega = spin * math.pi / 30
    if omega == 0:
        omega = 1e-9

    romega = (ball.circumference_in / 2 / math.pi) * omega / 12
    vw0 = math.sqrt((vx0 - vxw) ** 2 + (vy0 - vyw) ** 2 + vz0**2)
    s0 = romega / vw0

    cl0 = 0.583
    cl1 = 2.333
    cl2 = 1.120
    cd0 = 0.3008
    cdspin = 0.0292

    x_values, y_values, z_values, vx_values, vy_values, vz_values, speed_values, time_values = integrate_flight(
        float(start.x_ft), float(start.y_ft), float(start.z_ft), vx0, vy0, vz0, vw0, v0, s0,
        k, spin, vxw, vyw, wx, wy, wz, omega, romega, dt_s)

    end = next(idx for idx, z in enumerate(z_values) if z < 0)
    keep = end + 2
    x_values = x_values[:keep]
    y_values = y_values[:keep]
    z_values = z_values[:keep]
    vx_values = vx_values[:keep]
    vy_values = vy_values[:keep]
    vz_values = vz_values[:keep]
    speed_values = speed_values[:keep]
    time_values = time_values[:keep]

    distance_ft = math.hypot(x_values[end], y_values[end])
    hang_time_s = time_values[end]
    apex_index = max(range(end), key=lambda idx: z_values[idx])
    apex_ft = z_values[apex_index]
    apex_time_s = time_values[apex_index]
    # Optimizer evaluations only need bracketing samples at the observation
    # times. Keep identical integration and landing/apex calculations, while
    # avoiding hundreds of unused Python objects on each trial flight.
    indices = range(end)
    if sample_times is not None:
        selected = {0, end - 1}
        for sample in sample_times:
            upper = min(end - 1, bisect_right(time_values, float(sample), 0, end))
            selected.update((max(0, upper - 1), upper))
        indices = sorted(selected)
    if _position_buffer is not None:
        # Optimizer trials need positions plus landing/apex metadata, not a
        # Python object carrying every velocity and display field per sample.
        _position_buffer.extend((time_values[j], x_values[j], y_values[j], z_values[j]) for j in indices)
        indices = ()
    points = [
        TrajectoryPoint(
            t_s=time_values[j],
            x_ft=x_values[j],
            y_ft=y_values[j],
            z_ft=z_values[j],
            vx_ft_s=vx_values[j],
            vy_ft_s=vy_values[j],
            vz_ft_s=vz_values[j],
            speed_ft_s=speed_values[j],
            distance_ft=math.hypot(x_values[j], y_values[j]),
            height_ft=z_values[j],
        )
        for j in indices
    ]

    bfs_x_end = x_values[end] / 2.4 + 0.2
    bfs_y_end = y_values[end] / 2.4 - 78.4

    return Trajectory(
        points=points,
        distance_ft=distance_ft,
        hang_time_s=hang_time_s,
        apex_ft=apex_ft,
        apex_time_s=apex_time_s,
        landing_x_ft=x_values[end],
        landing_y_ft=y_values[end],
        landing_spray_angle_deg=round(calc_angle_degrees(x_values[end], y_values[end]), 1),
        bfs_display_angle_deg=round(calc_angle_degrees(bfs_x_end, bfs_y_end), 1),
        backspin_rpm=backspin,
        sidespin_rpm=sidespin,
        spin_rpm=spin,
    )
