'use strict';

(function (root) {
    function calculateIndoorPM25(input) {
        if (!input || typeof input !== 'object') {
            throw new TypeError('Simulation inputs are required.');
        }

        const {
            C0, Co, V, lambda, P, k, CADR, source, t
        } = input;

        const values = [C0, Co, V, lambda, P, k, CADR, source, t];

        if (values.some((value) => !Number.isFinite(value))) {
            throw new RangeError('All simulator inputs must be finite numbers.');
        }

        if (
            C0 < 0 || Co < 0 || V <= 0 ||
            lambda < 0 || P < 0 || P > 1 ||
            k < 0 || CADR < 0 || source < 0 || t < 0
        ) {
            throw new RangeError('Simulator inputs are outside their valid ranges.');
        }

        // A is the total particle input rate per room volume (µg/m³/h).
        // K is the total first-order removal rate (h⁻¹).
        const A = P * lambda * Co + source / V;
        const K = lambda + k + CADR / V;

        // With no removal, there is no unique finite steady state.
        // Concentration remains constant when A is zero, or rises linearly when A > 0.
        if (K === 0) {
            return {
                A,
                K,
                steadyState: null,
                concentration: C0 + A * t,
                t90SteadyStateMinutes: null,
                t90AbsoluteMinutes: null
            };
        }

        const steadyState = A / K;
        const concentration =
            steadyState + (C0 - steadyState) * Math.exp(-K * t);

        const t90SteadyStateMinutes = Math.log(10) / K * 60;

        // Absolute 90% clearance is possible only if the steady state
        // is strictly below 10% of the initial concentration.
        let t90AbsoluteMinutes = null;

        if (C0 > 0 && steadyState < 0.1 * C0 && C0 > steadyState) {
            const ratio = (0.1 * C0 - steadyState) / (C0 - steadyState);
            t90AbsoluteMinutes = -Math.log(ratio) / K * 60;
        }

        return {
            A,
            K,
            steadyState,
            concentration,
            t90SteadyStateMinutes,
            t90AbsoluteMinutes
        };
    }

    root.AirLabSimulation = Object.freeze({ calculateIndoorPM25 });
}(typeof globalThis !== 'undefined' ? globalThis : window));
