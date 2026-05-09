/**
 * Unit tests for buildIssueUrl URI length handling
 * 
 * Tests verify that when a GitHub issue URL would exceed 7200 bytes,
 * the code sample is automatically omitted and the URL is regenerated.
 */

import { buildIssueUrl } from '../src/share-core.js';

describe('buildIssueUrl URI length handling', () => {
    test('small code sample is included when URL is under 7200 bytes', () => {
        const url = buildIssueUrl(
            'micropython-esp32-stubs',
            '1.28.0',
            'standard',
            'https://example.com/playground',
            [],
            [],
            "print('hello')"
        );
        
        expect(url.length).toBeLessThan(7200);
        expect(url).toContain('%60%60%60python'); // URL encoded ```python
        expect(url).toContain('print');
    });

    test('large code sample is omitted when URL would exceed 7200 bytes', () => {
        // Create large code sample to exceed limit
        const largeCode = '# This is a long line\n'.repeat(300);
        const longUrl = 'https://very-long-playground-url-that-contributes-significantly-to-uri-length.example.com/playground?board=esp32&stdlib=micropython&version=3.10&extra_param=with_more_data';
        
        const url = buildIssueUrl(
            'micropython-esp32-stubs',
            '1.28.0.post3',
            'standard',
            longUrl,
            [],
            [],
            largeCode
        );
        
        // URL should be under 7200 after automatic removal
        expect(url.length).toBeLessThan(7200);
        // Code block should not be present
        expect(url).not.toContain('%60%60%60python');
        // But playground link should still be there
        expect(url).toContain(encodeURIComponent(longUrl));
    });

    test('diagnostics are preserved when code sample is removed', () => {
        const largeCode = '# This is a long line\n'.repeat(300);
        const longUrl = 'https://very-long-playground-url-that-contributes-significantly-to-uri-length.example.com/playground?board=esp32&stdlib=micropython&version=3.10&extra_param=with_more_data';
        
        const diagnostics = [
            {
                fileName: 'main.py',
                line: 10,
                character: 5,
                severity: 'error',
                message: 'Name "foo" is not defined'
            }
        ];
        
        const url = buildIssueUrl(
            'micropython-esp32-stubs',
            '1.28.0.post3',
            'standard',
            longUrl,
            [],
            diagnostics,
            largeCode
        );
        
        // URL should be under 7200
        expect(url.length).toBeLessThan(7200);
        // Code block should be removed
        expect(url).not.toContain('%60%60%60python');
        // But diagnostics should still be present
        expect(url).toContain('%23%23%20Diagnostics'); // URL encoded ## Diagnostics
        expect(url).toContain('Name%20%22foo%22%20is%20not%20defined');
    });

    test('code sample is included if no regeneration needed', () => {
        const smallCode = 'x = 1';
        const shortUrl = 'https://example.com/p';
        
        const url = buildIssueUrl(
            'stubs-pkg',
            '1.0',
            'standard',
            shortUrl,
            [],
            [],
            smallCode
        );
        
        // Should stay under limit without regeneration
        expect(url.length).toBeLessThan(7200);
        // Code should be included
        expect(url).toContain(encodeURIComponent(smallCode));
    });

    test('empty code sample does not trigger regeneration', () => {
        const longUrl = 'https://very-long-playground-url-that-contributes-significantly.example.com/playground?board=esp32&stdlib=micropython&version=3.10&extra_param=with_more_data';
        
        const url = buildIssueUrl(
            'micropython-esp32-stubs',
            '1.28.0.post3',
            'standard',
            longUrl,
            [],
            [],
            '' // Empty code sample
        );
        
        // Should work fine even with long URL since no code sample
        expect(url).toBeDefined();
        expect(url).toContain(encodeURIComponent(longUrl));
    });
});
