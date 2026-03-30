// ==========================================
// 1. 수파베이스 설정 (사용자 정보로 변경하세요)
// ==========================================
const SUPABASE_URL = 'https://wnayexlkyvfpbeohvind.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InduYXlleGxreXZmcGJlb2h2aW5kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4NjQ0NzQsImV4cCI6MjA5MDQ0MDQ3NH0.4ysWMpaWg5GBrksYTJwznvQS7P15J8__pHZd_CervLg';

// 전역 변수 설정
let supabase = null;
let currentFile = null;
let currentFilter = 'all'; // 교사 대시보드 팀 필터

// CDN 로딩 지연 등으로 에러가 발생하더라도 화면(UI) 버튼 동작은 정상 작동되게 try-catch로 감쌉니다.
try {
  // 수파베이스 클라이언트 초기화
  if (window.supabase) supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  else console.warn("Supabase 라이브러리를 정상적으로 불러오지 못했습니다.");
} catch(e) {
  console.error("수파베이스 초기화 중 에러:", e);
}

// ==========================================
// 2. 화면 전환 함수
// ==========================================
// 특정 화면만 보여주고 나머지는 숨깁니다.
function showView(viewId) {
  document.getElementById('view-select').classList.add('hidden');
  document.getElementById('view-student').classList.add('hidden');
  document.getElementById('view-teacher').classList.add('hidden');
  document.getElementById(viewId).classList.remove('hidden');

  // 교사 모드로 진입하면 즉시 데이터 로드
  if (viewId === 'view-teacher') {
    loadFeed();
    subscribeRealtime(); // 실시간 알림 켜기
  }
}

// 로딩 화면 제어
function showLoading(show, message = '처리 중...') {
  const loader = document.getElementById('loading');
  document.getElementById('loading-text').innerText = message;
  if (show) loader.classList.remove('hidden');
  else loader.classList.add('hidden');
}

// 홈 버튼들 (학생, 교사 모드 안에서 뒤로가기)
document.querySelectorAll('.btn-home').forEach(btn => {
  btn.addEventListener('click', () => showView('view-select'));
});

// 메인 모드 선택 버튼
document.getElementById('btn-mode-student').addEventListener('click', () => showView('view-student'));
document.getElementById('btn-mode-teacher').addEventListener('click', () => showView('view-teacher'));


// ==========================================
// 3. 학생 모드: 사진 미리보기 및 제출 로직
// ==========================================
const fileInput = document.getElementById('file-input');
const photoBox = document.getElementById('photo-box');
const photoPreview = document.getElementById('photo-preview');
const placeholder = document.getElementById('photo-placeholder');

// 사진 선택 시 미리보기
fileInput.addEventListener('change', function (e) {
  const file = e.target.files[0];
  if (!file) return;

  currentFile = file;
  const reader = new FileReader();
  reader.onload = function (e) {
    photoPreview.src = e.target.result;
    photoPreview.classList.remove('hidden');
    placeholder.classList.add('hidden');
    photoBox.classList.add('has-image');
  }
  reader.readAsDataURL(file);
});

// 양식 제출 버튼 클릭 시
document.getElementById('btn-submit').addEventListener('click', async () => {
  const teamId = document.getElementById('team-select').value;
  const statusEl = document.querySelector('input[name="status_type"]:checked');
  const hazardEl = document.querySelector('input[name="hazard_type"]:checked');
  const desc = document.getElementById('desc-input').value;

  // 값 검증 (빈칸 확인)
  if (!teamId) return alert('팀을 선택해 주세요.');
  if (!currentFile) return alert('안전 상태를 확인할 수 있는 사진을 촬영해 주세요.');
  if (!statusEl) return alert('조치 양호/미흡 상태를 선택해 주세요.');
  if (!hazardEl) return alert('어떤 위험 상태인지 카테고리를 선택해 주세요.');
  if (!desc) return alert('상세 설명을 간단히 적어주세요.');

  showLoading(true, '사진 업로드 중...');

  try {
    // 1단계: 수파베이스 스토리지에 사진 업로드 (폴더: safety_photos)
    const fileName = `${Date.now()}_team${teamId}_${currentFile.name}`;
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('safety_photos')
      .upload(fileName, currentFile);

    if (uploadError) throw new Error('사진 업로드 실패: ' + uploadError.message);

    // 2단계: 업로드한 사진의 실제 접속 주소(URL) 가져오기
    const { data: { publicUrl } } = supabase.storage
      .from('safety_photos')
      .getPublicUrl(fileName);

    showLoading(true, '보고서 등록 중...');

    // 3단계: 사진 주소와 입력된 글씨들을 Database에 저장
    const { error: dbError } = await supabase
      .from('safety_reports')
      .insert([{
        team_id: teamId,
        status_type: statusEl.value,
        hazard_type: hazardEl.value,
        description: desc,
        image_url: publicUrl
      }]);

    if (dbError) throw new Error('DB 저장 실패: ' + dbError.message);

    // 성공 시 정리 및 초기화
    alert('✅ 성공적으로 현장 보고서가 전송되었습니다!');

    // 초기화
    document.getElementById('team-select').value = '';
    document.getElementById('desc-input').value = '';
    statusEl.checked = false;
    hazardEl.checked = false;
    currentFile = null;
    photoPreview.classList.add('hidden');
    placeholder.classList.remove('hidden');
    photoBox.classList.remove('has-image');

    showView('view-select'); // 메인 화면으로 돌아가기

  } catch (error) {
    alert(error.message);
  } finally {
    showLoading(false);
  }
});


// ==========================================
// 4. 교사 대시보드: 데이터 불러오기 및 실시간 연동
// ==========================================
// 팀 필터 버튼 클릭
document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    // 버튼 모양 변경
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    e.target.classList.add('active');

    // 필터 값 변경 후 데이터 재로드
    currentFilter = e.target.dataset.filter;
    loadFeed();
  });
});

// 피드 및 통계 데이터 불러오기
async function loadFeed() {
  const container = document.getElementById('feed-container');

  try {
    // DB에서 목록을 시간 역순(최신순)으로 가져옵니다.
    let query = supabase.from('safety_reports').select('*').order('created_at', { ascending: false });

    // 필터가 'all'이 아니면 해당 팀만 필터링합니다.
    if (currentFilter !== 'all') {
      query = query.eq('team_id', currentFilter);
    }

    const { data, error } = await query;
    if (error) throw error;

    // 통계 업데이트 (필터에 상관없이 전체 데이터 기준을 보고 싶다면 쿼리를 두 개 쏘는게 맞지만, 
    // 여기서는 간단히 필터링된 화면 기준으로 누적 갯수를 셉니다)
    let dangerCount = 0;
    data.forEach(item => { if (item.status_type === 'danger') dangerCount++; });

    document.getElementById('stat-total').innerText = data.length;
    document.getElementById('stat-danger').innerText = dangerCount;

    // 화면(html) 구성
    container.innerHTML = ''; // 기존 내용 지우기

    if (data.length === 0) {
      container.innerHTML = `<div style="text-align:center; padding: 40px 0; color: var(--text-light);">아직 올라온 보고서가 없습니다.</div>`;
      return;
    }

    data.forEach(item => {
      // 배지(Badge) 모양 정하기
      const teamBadge = `<span class="badge badge-team">${item.team_id}팀</span>`;
      const hazardBadge = `<span class="badge badge-hazard">${item.hazard_type}</span>`;
      const statusBadge = item.status_type === 'good'
        ? `<span class="badge badge-good">✅ 양호</span>`
        : `<span class="badge badge-danger">🚨 미흡</span>`;

      // 날짜 표현 시간만 나오도록 (간결하게)
      const dateStr = new Date(item.created_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });

      // HTML 카드 만들기
      const cardHTML = `
        <div class="feed-card">
          <img src="${item.image_url}" class="feed-img" alt="현장 사진">
          <div class="feed-content">
            <div class="feed-badge-group">
              ${teamBadge} ${hazardBadge} ${statusBadge}
            </div>
            <p class="feed-desc">${item.description}</p>
            <div class="feed-time">보고 시간: ${dateStr}</div>
          </div>
        </div>
      `;
      container.innerHTML += cardHTML;
    });

  } catch (error) {
    console.error("데이터 로딩 에러:", error);
    container.innerHTML = `<div style="text-align:center; padding: 40px 0; color: #ef4444;">데이터를 불러오는 중 문제가 발생했습니다. (수파베이스 설정을 환인해주세요)</div>`;
  }
}

// 실시간(Realtime) 구독 채널
let myChannel = null;

function subscribeRealtime() {
  // 이미 구독 중이라면 패스
  if (myChannel) return;

  // DB의 'safety_reports' 테이블에 새로운 INSERT(글쓰기) 이벤트가 생기면?
  myChannel = supabase
    .channel('public:safety_reports')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'safety_reports' }, payload => {
      console.log("새로운 데이터 감지!", payload);
      // 새로운 데이터가 들어오면 피드(화면)를 새로고침 합니다.
      loadFeed();
    })
    .subscribe();
}
