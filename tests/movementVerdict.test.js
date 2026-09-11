/**
 * Vertical scroll movement verdict (VerticalScrollHelper._direction and _verdict).
 *
 * Offline: pure functions, no browser. The direction logic has to survive the marquee's
 * loop reset, which jumps a column by a whole set height inside one sampling interval, and
 * it must never fail a widget that stopped itself or a legacy column with no direction class.
 *
 * Run: node tests/movementVerdict.test.js
 */

const VerticalScrollHelper = require('../helpers/interactiveWidgets/verticalScrollHelper');

const results = { passed: 0, failed: 0 };

function check(name, condition, detail) {
    if (condition) {
        results.passed++;
        console.log(`  PASS  ${name}`);
    } else {
        results.failed++;
        console.error(`  FAIL  ${name}${detail ? ` -- ${detail}` : ''}`);
    }
}

// One column's positions over time, and the sample-major shape _verdict receives.
const column = (built, tops, stopped = false) => tops.map(top => ({ top, built, stopped }));
const samplesOf = (...columns) => columns[0].map((_, t) => columns.map(c => c[t]));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const { _direction: direction } = VerticalScrollHelper;

console.log('\nVertical scroll movement verdict\n');

console.log('Direction:');
check('a column rising steadily moves UP', direction.call(VerticalScrollHelper, [100, 90, 80, 70]) === 'UP');
check('a column falling steadily moves DOWN', direction.call(VerticalScrollHelper, [70, 80, 90, 100]) === 'DOWN');
check('sub-pixel jitter is STATIONARY', direction.call(VerticalScrollHelper, [100, 100.4, 100.1, 100]) === 'STATIONARY');
check('a loop reset inside one interval does not reverse an UP column', direction.call(VerticalScrollHelper, [100, 90, 490, 480]) === 'UP');
check('a reset that ties the vote is broken by the smaller step', direction.call(VerticalScrollHelper, [100, 90, 490]) === 'UP');

console.log('\nConfigured direction (mirrors Astro getDirectionClass):');
check("'alter' starts UP and alternates", same(VerticalScrollHelper._configuredDirections({ marquee_direction: 'alter' }, 3), ['UP', 'DOWN', 'UP']));
check("'down' applies to every column, nested customization included", same(VerticalScrollHelper._configuredDirections({ widget_customization: { marquee_direction: 'down' } }, 2), ['DOWN', 'DOWN']));
check('an absent direction is not guessed', VerticalScrollHelper._configuredDirections({}, 3) === null);

console.log('\nVerdict:');
{
    const r = VerticalScrollHelper._verdict(samplesOf(column('UP', [100, 90, 80, 70]), column('DOWN', [70, 80, 90, 100])), ['UP', 'DOWN']);
    check('columns moving as built and configured PASS', r.status === 'PASS', r.message);
}
{
    const r = VerticalScrollHelper._verdict(samplesOf(column('UP', [70, 80, 90, 100])), null);
    check('a column moving against its built direction FAILs', r.status === 'FAIL', r.message);
}
{
    const r = VerticalScrollHelper._verdict(samplesOf(column('UP', [100, 90, 80, 70]), column('UP', [100, 90, 80, 70])), ['UP', 'DOWN']);
    check('a column built against marquee_direction FAILs', r.status === 'FAIL', r.message);
}
{
    const r = VerticalScrollHelper._verdict(samplesOf(column('UP', [100, 100, 100, 100], true)), ['UP']);
    check('a widget that stopped its own animation is SKIPPED, never failed', r.status === 'SKIPPED', r.message);
}
{
    const r = VerticalScrollHelper._verdict(samplesOf(column('UP', [100, 100, 100, 100])), ['UP']);
    check('no movement at all is SKIPPED, never failed', r.status === 'SKIPPED', r.message);
}
{
    const r = VerticalScrollHelper._verdict(samplesOf(column(null, [70, 80, 90, 100])), ['UP']);
    check('a legacy column with no direction class is reported, never failed', r.status === 'PASS', r.message);
}

console.log(`\n${results.passed} passed, ${results.failed} failed\n`);
process.exit(results.failed > 0 ? 1 : 0);
