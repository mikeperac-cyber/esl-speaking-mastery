import glob
import re
import json
import os

day_files = sorted(glob.glob('Day_*.md'))
all_data = []
total_q = 0
total_v = 0

for filepath in day_files:
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Day number & title
    title_match = re.search(r'#\s*.*Day\s*0?(\d+):\s*(.+)', content)
    day_num = int(title_match.group(1)) if title_match else len(all_data)+1
    title = title_match.group(2).strip() if title_match else 'Topic'
    
    domain_match = re.search(r'\*\*Core Domain\*\*:\s*(.+)', content)
    domain = domain_match.group(1).strip() if domain_match else ''
    
    # Objectives
    obj_match = re.search(r'## 🎯 Learning Objectives\nBy the end of today\'s lesson[^\n]*\n((?:\d+\..+\n?)+)', content)
    objectives = []
    if obj_match:
        for line in obj_match.group(1).strip().split('\n'):
            cleaned = re.sub(r'^\d+\.\s*', '', line).strip()
            if cleaned:
                objectives.append(cleaned)

    # Questions
    q_matches = re.findall(r'(\d+)\.\s+\*\*Question\s*\d+\*\*:\s*(.+)', content)
    questions = []
    for q_num_str, q_text in q_matches:
        q_idx = int(q_num_str)
        tier = 'Tier 1: Warm-up' if len(questions) < 5 else ('Tier 2: In-Depth' if len(questions) < 10 else 'Tier 3: Debate / Abstract')
        questions.append({
            'num': q_idx,
            'tier': tier,
            'text': q_text.strip()
        })
    
    # Vocabulary
    # Format: 1. **Equilibrium** *(n.)* `/ˌiːkwɪˈlɪbriəm/`
    v_blocks = re.findall(
        r'(\d+)\.\s+\*\*([^*]+)\*\*\s+\*\(?([^*)]+)\)?\*\s+`([^`]+)`\s+- \*Definition\*:\s*([^\n]+)\s+- \*Collocations\*:\s*([^\n]+)\s+- \*Example\*:\s*([^\n]+)',
        content
    )
    vocab_list = []
    for v_num, word, pos, ipa, definition, collocations, example in v_blocks:
        vocab_list.append({
            'num': int(v_num),
            'word': word.strip(),
            'pos': pos.strip().strip('()'),
            'ipa': ipa.strip(),
            'definition': definition.strip(),
            'collocations': collocations.strip(),
            'example': example.strip()
        })
    
    # Idioms table
    idioms_table = re.search(r'## 🗣️ Idiomatic Expressions[^\n]*\n\n\|[^\n]+\n\|[^\n]+\n((?:\|[^\n]+\n?)+)', content)
    idioms = []
    if idioms_table:
        for row in idioms_table.group(1).strip().split('\n'):
            parts = [p.strip() for p in row.split('|')[1:-1]]
            if len(parts) >= 3:
                idioms.append({
                    'phrase': parts[0].replace('**', '').replace('"', ''),
                    'meaning': parts[1],
                    'example': parts[2].replace('*', '')
                })
                
    # Roleplay
    roleplay_match = re.search(
        r'## 🎭 Interactive Roleplay[^\n]*\n\*\*Scenario\*\*:\s*\*([^*]+)\*\n-\s+\*\*Role A[^*]*\*\*:\s*([^\n]+)\n-\s+\*\*Role B[^*]*\*\*:\s*([^\n]+)\n-\s+\*\*Target Constraint\*\*:\s*([^\n]+)',
        content
    )
    roleplay = {}
    if roleplay_match:
        roleplay = {
            'scenario': roleplay_match.group(1).strip(),
            'roleA': roleplay_match.group(2).strip(),
            'roleB': roleplay_match.group(3).strip(),
            'constraint': roleplay_match.group(4).strip()
        }

    total_q += len(questions)
    total_v += len(vocab_list)
    
    all_data.append({
        'day': day_num,
        'title': title,
        'domain': domain,
        'objectives': objectives,
        'questionCount': len(questions),
        'vocabCount': len(vocab_list),
        'questions': questions,
        'vocabulary': vocab_list,
        'idioms': idioms,
        'roleplay': roleplay
    })
    print(f'Day {day_num:02d}: {len(questions)} questions, {len(vocab_list)} vocab words')

print(f'\n--- SUMMARY ---')
print(f'TOTAL DAYS: {len(all_data)}')
print(f'TOTAL QUESTIONS: {total_q} / 150')
print(f'TOTAL VOCABULARY: {total_v} / 500')

with open('curriculum_data.json', 'w', encoding='utf-8') as f:
    json.dump(all_data, f, ensure_ascii=False, indent=2)

with open('curriculum_data.js', 'w', encoding='utf-8') as f:
    f.write('const CURRICULUM_DATA = ' + json.dumps(all_data, ensure_ascii=False, indent=2) + ';')

print('Generated curriculum_data.json and curriculum_data.js successfully!')
