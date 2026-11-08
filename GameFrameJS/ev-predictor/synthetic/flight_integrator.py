"""The existing fixed-step flight equations, optionally compiled without fastmath."""
import os
import math


def integrate_python(start_x, start_y, start_z, vx0, vy0, vz0, vw0, v0, s0,
                     k, spin, vxw, vyw, wx, wy, wz, omega, romega, dt_s):
    g, tau = 32.174, 10000
    cl0, cl1, cl2, cd0, cdspin = .583, 2.333, 1.120, .3008, .0292
    x_values, y_values, z_values = [start_x], [start_y], [start_z]
    vx_values, vy_values, vz_values = [vx0], [vy0], [vz0]
    vw_values, speed_values, time_values, spin_parameter_values = [vw0], [v0], [0.0], [s0]
    i = 0
    while z_values[i] >= -1 and time_values[i] < 10:
        t = time_values[i]
        vw = vw_values[i]
        cd = cd0 + cdspin * (spin / 1000) * math.exp(-t / (tau * 146.7 / vw))
        cl = cl2 * spin_parameter_values[i] / (cl0 + cl1 * spin_parameter_values[i])
        adragx = -k * cd * vw * (vx_values[i] - vxw)
        adragy = -k * cd * vw * (vy_values[i] - vyw)
        adragz = -k * cd * vw * vz_values[i]
        amagx = k * (cl / omega) * vw * (wy * vz_values[i] - wz * (vy_values[i] - vyw))
        amagy = k * (cl / omega) * vw * (wz * (vx_values[i] - vxw) - wx * vz_values[i])
        amagz = k * (cl / omega) * vw * (wx * (vy_values[i] - vyw) - wy * (vx_values[i] - vxw))
        ax, ay, az = adragx + amagx, adragy + amagy, adragz + amagz - g
        x_values.append(x_values[i] + vx_values[i] * dt_s + .5 * ax * dt_s * dt_s)
        y_values.append(y_values[i] + vy_values[i] * dt_s + .5 * ay * dt_s * dt_s)
        z_values.append(z_values[i] + vz_values[i] * dt_s + .5 * az * dt_s * dt_s)
        vx_values.append(vx_values[i] + ax * dt_s)
        vy_values.append(vy_values[i] + ay * dt_s)
        vz_values.append(vz_values[i] + az * dt_s)
        vw_next = math.sqrt((vx_values[i+1]-vxw)**2 + (vy_values[i+1]-vyw)**2 + vz_values[i+1]**2)
        vw_values.append(vw_next)
        speed_values.append(math.sqrt(vx_values[i+1]**2 + vy_values[i+1]**2 + vz_values[i+1]**2))
        time_values.append(time_values[i] + dt_s)
        spin_parameter_values.append((romega / vw_next) * math.exp(-time_values[i+1] / (tau * 146.7 / vw_next)))
        i += 1
    return x_values, y_values, z_values, vx_values, vy_values, vz_values, speed_values, time_values


try:
    if os.environ.get('GAMEFRAME_FLIGHT_ACCELERATION', '1') == '0':
        raise ImportError('Acceleration disabled for this process')
    from numba import njit
    from numba.core.errors import NumbaError
    compiled_integrator = njit(cache=True, nogil=True, fastmath=False)(integrate_python)
except (ImportError, OSError):
    compiled_integrator = None
    NumbaError = RuntimeError


def integrate_flight(*arguments):
    global compiled_integrator
    if compiled_integrator is not None and os.environ.get('GAMEFRAME_FLIGHT_ACCELERATION', '1') != '0':
        try:
            return compiled_integrator(*arguments)
        except (NumbaError, OSError):
            # Optional acceleration must never remove the working Python path.
            compiled_integrator = None
    return integrate_python(*arguments)
